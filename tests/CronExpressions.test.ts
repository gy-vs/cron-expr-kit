import { CronExpressions, CronExpressionsResult, CronExpressionParser } from '../src';

const simplify = (results: CronExpressionsResult[]) =>
  results.map((result) => ({ date: result.date.toISOString(), expressionIndices: result.expressionIndices }));

describe('CronExpressionParser.parseMany', () => {
  describe('invalid input', () => {
    test('empty array of expressions', () => {
      expect(() => CronExpressionParser.parseMany([])).toThrow(
        'Invalid cron expressions, expected a non-empty array of cron expressions',
      );
    });

    test('not an array', () => {
      expect(() => CronExpressionParser.parseMany('0 0 * * * *' as any)).toThrow(
        'Invalid cron expressions, expected a non-empty array of cron expressions',
      );
    });

    test('invalid expression reports its index', () => {
      expect(() => CronExpressionParser.parseMany(['0 0 * * * *', '61 * * * * *'])).toThrow(
        'Invalid cron expression at index 1: Constraint error, got value 61 expected range 0-59',
      );
    });

    test('invalid first expression reports index 0', () => {
      expect(() => CronExpressionParser.parseMany(['* * * * * * *'])).toThrow(
        'Invalid cron expression at index 0: Invalid cron expression, too many fields',
      );
    });

    test('options are validated for every expression at parse time', () => {
      expect(() => CronExpressionParser.parseMany(['0 0 0 * * *', '0 0 0 1 * 1'], { strict: true })).toThrow(
        'Invalid cron expression at index 1: Cannot use both dayOfMonth and dayOfWeek together in strict mode!',
      );
    });
  });

  describe('merging', () => {
    test('merges expressions in chronological order with source indices', () => {
      const schedule = CronExpressionParser.parseMany(['0 */15 * * * *', '0 0 */2 * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
      });
      expect(simplify(schedule.take(8))).toEqual([
        { date: '2023-01-01T00:15:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T00:30:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T00:45:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T01:00:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T01:15:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T01:30:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T01:45:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T02:00:00.000Z', expressionIndices: [0, 1] },
      ]);
    });

    test('a date hit by several expressions is returned only once with all indices', () => {
      const schedule = CronExpressionParser.parseMany(['0 0 * * * *', '0 0 * * * *', '0 30 * * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
      });
      expect(simplify(schedule.take(4))).toEqual([
        { date: '2023-01-01T00:30:00.000Z', expressionIndices: [2] },
        { date: '2023-01-01T01:00:00.000Z', expressionIndices: [0, 1] },
        { date: '2023-01-01T01:30:00.000Z', expressionIndices: [2] },
        { date: '2023-01-01T02:00:00.000Z', expressionIndices: [0, 1] },
      ]);
    });

    test('a date hit by all expressions carries every index', () => {
      const schedule = CronExpressionParser.parseMany(['0 0 12 * * *', '0 0 12 * * *', '0 0 12 * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
      });
      const first = schedule.next();
      expect(first.date.toISOString()).toBe('2023-01-01T12:00:00.000Z');
      expect(first.expressionIndices).toEqual([0, 1, 2]);
      const second = schedule.next();
      expect(second.date.toISOString()).toBe('2023-01-02T12:00:00.000Z');
      expect(second.expressionIndices).toEqual([0, 1, 2]);
    });

    test('weekday/weekend/month-end schedules combined', () => {
      const expressions = [
        '0 */15 * * * 1-5', // weekdays every 15 minutes
        '0 0 */2 * * 0,6', // weekends every 2 hours
        '0 55 23 L * *', // last day of the month at 23:55
      ];
      const schedule = CronExpressionParser.parseMany(expressions, {
        currentDate: '2023-01-27T12:00:00Z', // Friday
      });
      expect(simplify(schedule.take(4))).toEqual([
        { date: '2023-01-27T12:15:00.000Z', expressionIndices: [0] },
        { date: '2023-01-27T12:30:00.000Z', expressionIndices: [0] },
        { date: '2023-01-27T12:45:00.000Z', expressionIndices: [0] },
        { date: '2023-01-27T13:00:00.000Z', expressionIndices: [0] },
      ]);

      // Friday 23:50 -> the weekday schedule pauses, the weekend schedule takes over
      schedule.reset(new Date('2023-01-27T23:50:00Z'));
      expect(simplify(schedule.take(3))).toEqual([
        { date: '2023-01-28T00:00:00.000Z', expressionIndices: [1] },
        { date: '2023-01-28T02:00:00.000Z', expressionIndices: [1] },
        { date: '2023-01-28T04:00:00.000Z', expressionIndices: [1] },
      ]);

      // January 31st (a Tuesday) is the last day of the month
      schedule.reset(new Date('2023-01-31T23:50:00Z'));
      expect(simplify(schedule.take(2))).toEqual([
        { date: '2023-01-31T23:55:00.000Z', expressionIndices: [2] },
        { date: '2023-02-01T00:00:00.000Z', expressionIndices: [0] },
      ]);
    });

    test('behaves like parse for a single expression', () => {
      const options = { currentDate: '2023-01-01T00:00:00Z' };
      const merged = CronExpressionParser.parseMany(['0 */30 * * * *'], options);
      const single = CronExpressionParser.parse('0 */30 * * * *', options);
      expect(merged).toBeInstanceOf(CronExpressions);
      expect(merged.take(4).map((result) => result.date.toISOString())).toEqual(
        single.take(4).map((date) => date.toISOString()),
      );
      expect(
        CronExpressionParser.parseMany(['0 */30 * * * *'], options)
          .take(4)
          .map((result) => result.expressionIndices),
      ).toEqual([[0], [0], [0], [0]]);
    });
  });

  describe('options', () => {
    test('tz applies to all expressions', () => {
      const schedule = CronExpressionParser.parseMany(['0 0 9 * * *', '0 0 18 * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
        tz: 'America/New_York',
      });
      const first = schedule.next();
      expect(first.date.getTime()).toBe(Date.UTC(2023, 0, 1, 14, 0, 0)); // 09:00 EST
      expect(first.expressionIndices).toEqual([0]);
      const second = schedule.next();
      expect(second.date.getTime()).toBe(Date.UTC(2023, 0, 1, 23, 0, 0)); // 18:00 EST
      expect(second.expressionIndices).toEqual([1]);
    });

    test('endDate bounds every expression', () => {
      const schedule = CronExpressionParser.parseMany(['0 0 12 * * *', '0 30 13 * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
        endDate: '2023-01-03T00:00:00Z',
      });
      expect(schedule.hasNext()).toBe(true);
      expect(simplify(schedule.take(10))).toEqual([
        { date: '2023-01-01T12:00:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T13:30:00.000Z', expressionIndices: [1] },
        { date: '2023-01-02T12:00:00.000Z', expressionIndices: [0] },
        { date: '2023-01-02T13:30:00.000Z', expressionIndices: [1] },
      ]);
      expect(schedule.hasNext()).toBe(false);
      expect(() => schedule.next()).toThrow('Out of the time span range');
    });

    test('startDate bounds every expression', () => {
      const schedule = CronExpressionParser.parseMany(['0 0 12 * * *', '0 30 13 * * *'], {
        currentDate: '2023-01-05T00:00:00Z',
        startDate: '2023-01-02T00:00:00Z',
      });
      expect(schedule.hasPrev()).toBe(true);
      expect(simplify(schedule.take(-10))).toEqual([
        { date: '2023-01-04T13:30:00.000Z', expressionIndices: [1] },
        { date: '2023-01-04T12:00:00.000Z', expressionIndices: [0] },
        { date: '2023-01-03T13:30:00.000Z', expressionIndices: [1] },
        { date: '2023-01-03T12:00:00.000Z', expressionIndices: [0] },
        { date: '2023-01-02T13:30:00.000Z', expressionIndices: [1] },
        { date: '2023-01-02T12:00:00.000Z', expressionIndices: [0] },
      ]);
      expect(schedule.hasPrev()).toBe(false);
      expect(() => schedule.prev()).toThrow('Out of the time span range');
    });
  });

  describe('backward and mixed iteration', () => {
    test('prev iterates the merged schedule in reverse chronological order', () => {
      const schedule = CronExpressionParser.parseMany(['0 */20 * * * *', '0 5 * * * *'], {
        currentDate: '2023-01-01T02:00:00Z',
      });
      expect(simplify(schedule.take(-5))).toEqual([
        { date: '2023-01-01T01:40:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T01:20:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T01:05:00.000Z', expressionIndices: [1] },
        { date: '2023-01-01T01:00:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T00:40:00.000Z', expressionIndices: [0] },
      ]);
    });

    test('alternating next and prev stays on the same sequence', () => {
      const schedule = CronExpressionParser.parseMany(['0 */20 * * * *', '0 5 * * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
      });
      const step = (result: CronExpressionsResult) => ({
        date: result.date.toISOString(),
        expressionIndices: result.expressionIndices,
      });
      expect(step(schedule.next())).toEqual({ date: '2023-01-01T00:05:00.000Z', expressionIndices: [1] });
      expect(step(schedule.next())).toEqual({ date: '2023-01-01T00:20:00.000Z', expressionIndices: [0] });
      expect(step(schedule.next())).toEqual({ date: '2023-01-01T00:40:00.000Z', expressionIndices: [0] });
      expect(step(schedule.prev())).toEqual({ date: '2023-01-01T00:20:00.000Z', expressionIndices: [0] });
      expect(step(schedule.prev())).toEqual({ date: '2023-01-01T00:05:00.000Z', expressionIndices: [1] });
      expect(step(schedule.next())).toEqual({ date: '2023-01-01T00:20:00.000Z', expressionIndices: [0] });
      expect(step(schedule.next())).toEqual({ date: '2023-01-01T00:40:00.000Z', expressionIndices: [0] });
      expect(step(schedule.next())).toEqual({ date: '2023-01-01T01:00:00.000Z', expressionIndices: [0] });
      expect(step(schedule.prev())).toEqual({ date: '2023-01-01T00:40:00.000Z', expressionIndices: [0] });
    });

    test('going back and forward again yields the same dates and indices', () => {
      const schedule = CronExpressionParser.parseMany(['0 */20 * * * *', '0 5 * * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
      });
      const forward = schedule.take(6);
      const backward = schedule.take(-5);
      const forwardAgain = schedule.take(5);
      expect(simplify(backward)).toEqual(simplify(forward.slice(0, 5).reverse()));
      expect(simplify(forwardAgain)).toEqual(simplify(forward.slice(1)));
    });

    test('hasNext does not disturb a following prev on an exact occurrence', () => {
      const schedule = CronExpressionParser.parseMany(['0 0 * * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
      });
      expect(schedule.hasNext()).toBe(true);
      expect(schedule.prev().date.toISOString()).toBe('2022-12-31T23:00:00.000Z');
      expect(schedule.next().date.toISOString()).toBe('2023-01-01T00:00:00.000Z');
    });

    test('hasPrev does not disturb a following next', () => {
      const schedule = CronExpressionParser.parseMany(['0 0 * * * *', '0 30 * * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
      });
      expect(schedule.hasPrev()).toBe(true);
      expect(schedule.next().date.toISOString()).toBe('2023-01-01T00:30:00.000Z');
    });
  });

  describe('hasNext/hasPrev', () => {
    test('hasNext does not consume occurrences', () => {
      const schedule = CronExpressionParser.parseMany(['0 0 * * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
      });
      expect(schedule.hasNext()).toBe(true);
      expect(schedule.hasNext()).toBe(true);
      expect(schedule.next().date.toISOString()).toBe('2023-01-01T01:00:00.000Z');
      expect(schedule.next().date.toISOString()).toBe('2023-01-01T02:00:00.000Z');
    });

    test('hasPrev is false when no previous occurrence exists', () => {
      const schedule = CronExpressionParser.parseMany(['0 0 12 * * *'], {
        currentDate: '2023-01-02T00:00:00Z',
        startDate: '2023-01-02T00:00:00Z',
      });
      expect(schedule.hasPrev()).toBe(false);
      expect(schedule.hasNext()).toBe(true);
    });
  });

  describe('take', () => {
    test('take(0) returns an empty array', () => {
      const schedule = CronExpressionParser.parseMany(['0 0 * * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
      });
      expect(schedule.take(0)).toEqual([]);
    });

    test('take stops at the end of the time span', () => {
      const schedule = CronExpressionParser.parseMany(['0 * * * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
        endDate: '2023-01-01T00:03:00Z',
      });
      expect(simplify(schedule.take(10))).toEqual([
        { date: '2023-01-01T00:01:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T00:02:00.000Z', expressionIndices: [0] },
        { date: '2023-01-01T00:03:00.000Z', expressionIndices: [0] },
      ]);
      expect(schedule.hasNext()).toBe(false);
    });
  });

  describe('reset', () => {
    test('reset restarts from the initial date, same as a new instance', () => {
      const options = { currentDate: '2023-01-01T00:00:00Z' };
      const expressions = ['0 */30 * * * *', '0 15 * * * *'];
      const schedule = CronExpressionParser.parseMany(expressions, options);
      schedule.take(5);
      schedule.reset();
      const fresh = CronExpressionParser.parseMany(expressions, options);
      expect(simplify(schedule.take(5))).toEqual(simplify(fresh.take(5)));
    });

    test('reset works when only startDate was provided', () => {
      const schedule = CronExpressionParser.parseMany(['0 0 12 * * *'], {
        startDate: '2023-06-01T00:00:00Z',
      });
      expect(schedule.next().date.toISOString()).toBe('2023-06-01T12:00:00.000Z');
      schedule.reset();
      expect(schedule.next().date.toISOString()).toBe('2023-06-01T12:00:00.000Z');
    });

    test('reset to a new date', () => {
      const schedule = CronExpressionParser.parseMany(['0 */30 * * * *', '0 15 * * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
      });
      schedule.take(3);
      schedule.reset(new Date('2023-02-01T00:00:00Z'));
      expect(simplify(schedule.take(2))).toEqual([
        { date: '2023-02-01T00:15:00.000Z', expressionIndices: [1] },
        { date: '2023-02-01T00:30:00.000Z', expressionIndices: [0] },
      ]);
      expect(schedule.prev().date.toISOString()).toBe('2023-02-01T00:15:00.000Z');
    });

    test('reset to a new date followed by a probe and a backward step', () => {
      const schedule = CronExpressionParser.parseMany(['0 */30 * * * *', '0 15 * * * *'], {
        currentDate: '2023-01-01T00:00:00Z',
      });
      schedule.reset(new Date('2023-02-01T00:00:00Z'));
      expect(schedule.hasNext()).toBe(true);
      expect(schedule.prev().date.toISOString()).toBe('2023-01-31T23:30:00.000Z');
    });
  });
});
