import datetime
import random
import string
from datetime import timedelta
from typing import Any, Dict, List, Tuple, Union

import sqlparse
from dateutil.relativedelta import relativedelta
from django.core.cache import cache
from django.db import connection
from django.db.models.functions.datetime import TruncDay, TruncHour, TruncMonth, TruncWeek
from django.db.models.query import QuerySet
from django.utils.timezone import now
from pypika import CustomFunction, Field, PyformatParameter, Query, Table
from pypika import functions as fn

from posthog.constants import TREND_FILTER_TYPE_ACTIONS, TREND_FILTER_TYPE_EVENTS
from posthog.models import Event, Filter, Team
from posthog.models.entity import Entity
from posthog.models.utils import namedtuplefetchall
from posthog.queries.base import BaseQuery
from posthog.utils import generate_cache_key


class Retention(BaseQuery):
    person_distinct_id = Table("posthog_persondistinctid")
    events = Table("posthog_event").as_("e")
    toDateTime = lambda self, v: v
    array_agg = CustomFunction("array_agg", ["arg"])
    distinct = CustomFunction("DISTINCT", ["arg"])

    def trunc_func(self, period: str, arg: Any):
        return CustomFunction("DATE_TRUNC", ["period", "date"])(period, arg)

    def preprocess_params(self, filter: Filter, total_intervals=11):
        period = filter.period or "Day"
        tdelta, t1 = self.determineTimedelta(total_intervals, period)
        filter._date_to = ((filter.date_to if filter.date_to else now()) + t1).isoformat()

        if period == "Hour":
            date_to = filter.date_to if filter.date_to else now()
            date_from: datetime.datetime = date_to - tdelta
        elif period == "Week":
            date_to = (filter.date_to if filter.date_to else now()).replace(hour=0, minute=0, second=0, microsecond=0)
            date_from = date_to - tdelta
            date_from = date_from - timedelta(days=date_from.isoweekday() % 7)
        else:
            date_to = (filter.date_to if filter.date_to else now()).replace(hour=0, minute=0, second=0, microsecond=0)
            date_from = date_to - tdelta

        filter._date_from = date_from.isoformat()
        filter._date_to = date_to.isoformat()

        entity = (
            Entity({"id": "$pageview", "type": TREND_FILTER_TYPE_EVENTS})
            if not filter.target_entity
            else filter.target_entity
        )

        # need explicit handling of date_from so it's not optional but also need filter object for date_filter_Q
        return filter, entity, date_from, date_to

    def process_result(
        self,
        resultset: Dict[Tuple[int, int], Dict[str, Any]],
        filter: Filter,
        date_from: datetime.datetime,
        total_intervals: int,
    ):

        result = [
            {
                "values": [
                    resultset.get((first_day, day), {"count": 0, "people": []})
                    for day in range(total_intervals - first_day)
                ],
                "label": "{} {}".format(filter.period, first_day),
                "date": (date_from + self.determineTimedelta(first_day, filter.period)[0]),
            }
            for first_day in range(total_intervals)
        ]

        return result

    def _execute_sql(
        self,
        filter: Filter,
        date_from: datetime.datetime,
        date_to: datetime.datetime,
        target_entity: Entity,
        team: Team,
    ) -> Dict[Tuple[int, int], Dict[str, Any]]:

        period = filter.period
        events: QuerySet = QuerySet()

        if target_entity.type == TREND_FILTER_TYPE_EVENTS:
            events = Event.objects.filter_by_event_with_people(event=target_entity.id, team_id=team.id)
        elif target_entity.type == TREND_FILTER_TYPE_ACTIONS:
            events = Event.objects.filter(action__pk=target_entity.id).add_person_id(team.id)

        filtered_events = events.filter(filter.date_filter_Q).filter(filter.properties_to_Q(team_id=team.pk))
        trunc, fields = self._get_trunc_func("timestamp", period)
        first_date = filtered_events.annotate(first_date=trunc).values("first_date", "person_id").distinct()

        event_query, events_query_params = filtered_events.query.sql_with_params()
        reference_event_query, first_date_params = first_date.query.sql_with_params()

        final_query = """
            SELECT
                {fields}
                COUNT(DISTINCT "events"."person_id"),
                array_agg(DISTINCT "events"."person_id") as people
            FROM ({event_query}) events
            LEFT JOIN ({reference_event_query}) first_event_date
              ON (events.person_id = first_event_date.person_id)
            WHERE timestamp >= first_date
            GROUP BY date, first_date
        """.format(
            event_query=event_query, reference_event_query=reference_event_query, fields=fields
        )

        start_params = (date_from, date_from) if period == "Month" or period == "Hour" else (filter.date_from,)
        print(sqlparse.format(str(final_query), reindent_aligned=True))
        test_query = self.final_query(period)
        print(sqlparse.format(str(test_query), reindent_aligned=True))
        test_params = {
            "team_id": team.pk,
            "start_date": filter.date_from,
            "end_date": filter.date_to,
            "target_event": target_entity.id,
            "period": period,
        }

        with connection.cursor() as cursor:
            cursor.execute(test_query, test_params)
            data = namedtuplefetchall(cursor)

            scores: dict = {}
            for datum in data:
                key = round(datum.period_to_event_days, 1)
                if not scores.get(key, None):
                    scores.update({key: {}})
                for person in datum.people:
                    if not scores[key].get(person, None):
                        scores[key].update({person: 1})
                    else:
                        scores[key][person] += 1

        by_dates = {}
        for row in data:
            people = sorted(row.people, key=lambda p: scores[round(row.period_to_event_days, 1)][int(p)], reverse=True,)

            random_key = "".join(
                random.SystemRandom().choice(string.ascii_uppercase + string.digits) for _ in range(10)
            )
            cache_key = generate_cache_key(
                "{}{}{}".format(random_key, str(round(row.period_to_event_days, 0)), str(team.pk))
            )
            cache.set(
                cache_key, people, 600,
            )
            by_dates.update(
                {
                    (int(row.period_to_event_days), int(row.period_between_events_days)): {
                        "count": row.count,
                        "people": people[0:100],
                        "offset": 100,
                        "next": cache_key if len(people) > 100 else None,
                    }
                }
            )

        return by_dates

    def run(self, filter: Filter, team: Team, *args, **kwargs) -> List[Dict[str, Any]]:
        total_intervals = kwargs.get("total_intervals", 11)
        filter, entity, date_from, date_to = self.preprocess_params(filter, total_intervals)
        resultset = self._execute_sql(filter, date_from, date_to, entity, team)
        result = self.process_result(resultset, filter, date_from, total_intervals)
        return result

    def determineTimedelta(
        self, total_intervals: int, period: str
    ) -> Tuple[Union[timedelta, relativedelta], Union[timedelta, relativedelta]]:
        if period == "Hour":
            return timedelta(hours=total_intervals), timedelta(hours=1)
        elif period == "Week":
            return timedelta(weeks=total_intervals), timedelta(weeks=1)
        elif period == "Month":
            return relativedelta(months=total_intervals), relativedelta(months=1)
        elif period == "Day":
            return timedelta(days=total_intervals), timedelta(days=1)
        else:
            raise ValueError(f"Period {period} is unsupported.")

    def _get_trunc_func(
        self, subject: str, period: str
    ) -> Tuple[Union[TruncHour, TruncDay, TruncWeek, TruncMonth], str]:
        if period == "Hour":
            fields = """
            FLOOR(DATE_PART('day', first_date - %s) * 24 + DATE_PART('hour', first_date - %s)) AS first_date,
            FLOOR(DATE_PART('day', timestamp - first_date) * 24 + DATE_PART('hour', timestamp - first_date)) AS date,
            """
            return TruncHour(subject), fields
        elif period == "Day":
            fields = """
            FLOOR(DATE_PART('day', first_date - %s)) AS first_date,
            FLOOR(DATE_PART('day', timestamp - first_date)) AS date,
            """
            return TruncDay(subject), fields
        elif period == "Week":
            fields = """
            FLOOR(DATE_PART('day', first_date - %s) / 7) AS first_date,
            FLOOR(DATE_PART('day', timestamp - first_date) / 7) AS date,
            """
            return TruncWeek(subject), fields
        elif period == "Month":
            fields = """
            FLOOR((DATE_PART('year', first_date) - DATE_PART('year', %s)) * 12 + DATE_PART('month', first_date) - DATE_PART('month', %s)) AS first_date,
            FLOOR((DATE_PART('year', timestamp) - DATE_PART('year', first_date)) * 12 + DATE_PART('month', timestamp) - DATE_PART('month', first_date)) AS date,
            """
            return TruncMonth(subject), fields
        else:
            raise ValueError(f"Period {period} is unsupported.")

    def person_query(self):
        person_distinct_id = self.person_distinct_id
        q = (
            Query.from_(person_distinct_id)
            .select(person_distinct_id.person_id, person_distinct_id.distinct_id)
            .where(person_distinct_id.team_id == PyformatParameter("team_id"))
        )
        return q

    def reference_query(self, period: str):
        events = self.events
        person_query = self.person_query().as_("pdi")
        toDateTime = self.toDateTime

        return (
            Query.from_(events)
            .join(person_query)
            .on(person_query.distinct_id == events.distinct_id)
            .select(
                self.trunc_func(period, events.timestamp).as_("event_date"), person_query.person_id.as_("person_id"),
            )
            .distinct()
            .where(toDateTime(events.timestamp) >= PyformatParameter("start_date"))
            .where(toDateTime(events.timestamp) <= PyformatParameter("end_date"))
            .where(events.team_id >= PyformatParameter("team_id"))
            .where(events.event == PyformatParameter("target_event"))
        )

    def event_query(self):
        events = self.events
        person_query = self.person_query().as_("pdi")
        toDateTime = self.toDateTime

        return (
            Query.from_(events)
            .join(person_query)
            .on(person_query.distinct_id == events.distinct_id)
            .select(events.timestamp.as_("event_date"), person_query.person_id.as_("person_id"),)
            .where(toDateTime(events.timestamp) >= PyformatParameter("start_date"))
            .where(toDateTime(events.timestamp) <= PyformatParameter("end_date"))
            .where(events.team_id >= PyformatParameter("team_id"))
            .where(events.event == PyformatParameter("target_event"))
        )

    def final_query(self, period: str, *fields):

        floor = CustomFunction("FLOOR", ["arg"])
        partFunc = CustomFunction("DATE_PART", ["period", "date"])
        event_query = self.event_query().as_("event")
        reference_event = self.reference_query(period).as_("reference_event")

        final_query = (
            Query.from_(event_query)
            .join(reference_event)
            .on(event_query.person_id == reference_event.person_id)
            .select(
                floor(
                    partFunc(PyformatParameter("period"), reference_event.event_date - PyformatParameter("start_date"))
                ).as_("period_to_event_days"),
                floor(partFunc(PyformatParameter("period"), event_query.event_date - reference_event.event_date)).as_(
                    "period_between_events_days"
                ),
                fn.Count(event_query.person_id).distinct().as_("count"),
                self.array_agg(self.distinct(event_query.person_id)).as_("people"),
            )
            .where(
                self.trunc_func(period, event_query.event_date) >= self.trunc_func(period, reference_event.event_date)
            )
            .groupby(Field("period_to_event_days"), Field("period_between_events_days"))
        )

        return str(final_query)
