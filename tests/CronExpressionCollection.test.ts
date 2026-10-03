import { CronDate } from '../src/CronDate';
import { TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE } from '../src/CronExpression';
import { CronExpressionCollection, CronExpressionCollectionResult } from '../src/CronExpressionCollection';
import { CronExpressionParser } from '../src';
import { expect } from '@jest/globals';

const toISOStrings = (results: CronExpressionCollectionResult[]): string[] =>
  results.map((result) => result.date.toISOString() as string);

const toIndices = (results: CronExpressionCollectionResult[]): number[][] => results.map((result) => result.indices);

describe('CronExpressionCollection', () => {
  describe('parseMany', () => {
    test('should return a CronExpressionCollection instance', () => {
      const expression = CronExpressionParser.parseMany(['* * * * *']);
      expect(expression).toBeInstanceOf(CronExpressionCollection);
    });

    test('should be constructible directly from parsed expressions', () => {
      const expression = new CronExpressionCollection([CronExpressionParser.parse('*/30 * * * *')]);
      const result = expression.next();
      // Without options the cursor starts at the current time, same as CronExpression.
      expect(result.date.getTime()).toBeGreaterThan(Date.now());
      expect(result.date.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
      expect(result.indices).toEqual([0]);
    });

    test('should throw when called with an empty array', () => {
      expect(() => CronExpressionParser.parseMany([])).toThrow(
        'parseMany requires a non-empty array of cron expressions',
      );
    });

    test('should throw when called without an array', () => {
      expect(() => CronExpressionParser.parseMany(null as any)).toThrow(
        'parseMany requires a non-empty array of cron expressions',
      );
    });

    test('should throw at parse time when any expression is invalid, reporting its index', () => {
      expect(() => CronExpressionParser.parseMany(['0 * * * *', '61 * * * * *', '0 0 * * *'])).toThrow(
        'Invalid cron expression at index 1: Constraint error, got value 61 expected range 0-59',
      );
    });

    test('should report index 0 when the first expression is invalid', () => {
      expect(() => CronExpressionParser.parseMany(['not a cron', '* * * * *'])).toThrow(
        'Invalid cron expression at index 0:',
      );
    });

    test('should pass options through to every expression', () => {
      expect(() => CronExpressionParser.parseMany(['0 0 0 * * *', '0 0 0 1 * 1'], { strict: true })).toThrow(
        'Invalid cron expression at index 1: Cannot use both dayOfMonth and dayOfWeek together in strict mode!',
      );
    });
  });

  describe('merged schedule', () => {
    test('should merge weekday/weekend/month-end expressions into one chronological sequence', () => {
      const expression = CronExpressionParser.parseMany(
        [
          '*/15 * * * 1-5', // weekdays every 15 minutes
          '0 */2 * * 0,6', // weekends every 2 hours
          '55 23 L * *', // last day of the month at 23:55
        ],
        // 2024-05-31 is a Friday and the last day of May
        { currentDate: '2024-05-31T23:30:00Z' },
      );

      const results = expression.take(4);
      expect(toISOStrings(results)).toEqual([
        '2024-05-31T23:45:00.000Z',
        '2024-05-31T23:55:00.000Z',
        '2024-06-01T00:00:00.000Z',
        '2024-06-01T02:00:00.000Z',
      ]);
      expect(toIndices(results)).toEqual([[0], [2], [1], [1]]);
    });

    test('should report a time triggered by several expressions only once, with all indices', () => {
      const expression = CronExpressionParser.parseMany(['0 12 * * 1', '0 12 * * *'], {
        currentDate: '2024-01-07T12:00:00Z', // Sunday noon
      });

      const monday = expression.next();
      expect(monday.date.toISOString()).toBe('2024-01-08T12:00:00.000Z');
      expect(monday.indices).toEqual([0, 1]);

      const tuesday = expression.next();
      expect(tuesday.date.toISOString()).toBe('2024-01-09T12:00:00.000Z');
      expect(tuesday.indices).toEqual([1]);
    });

    test('should report all indices for identical expressions', () => {
      const expression = CronExpressionParser.parseMany(['*/30 * * * *', '*/30 * * * *'], {
        currentDate: '2024-01-01T00:00:00Z',
      });

      const results = expression.take(3);
      expect(toISOStrings(results)).toEqual([
        '2024-01-01T00:30:00.000Z',
        '2024-01-01T01:00:00.000Z',
        '2024-01-01T01:30:00.000Z',
      ]);
      expect(toIndices(results)).toEqual([
        [0, 1],
        [0, 1],
        [0, 1],
      ]);
    });

    test('should match simultaneous triggers when iterating backwards', () => {
      const expression = CronExpressionParser.parseMany(['0 12 * * 1', '0 12 * * *'], {
        currentDate: '2024-01-10T00:00:00Z', // Wednesday
      });

      const tuesday = expression.prev();
      expect(tuesday.date.toISOString()).toBe('2024-01-09T12:00:00.000Z');
      expect(tuesday.indices).toEqual([1]);

      const monday = expression.prev();
      expect(monday.date.toISOString()).toBe('2024-01-08T12:00:00.000Z');
      expect(monday.indices).toEqual([0, 1]);
    });

    test('should behave like parse() when given a single expression', () => {
      const options = { currentDate: '2024-01-01T00:00:00Z' };
      const merged = CronExpressionParser.parseMany(['*/15 * * * *'], options);
      const single = CronExpressionParser.parse('*/15 * * * *', options);

      expect(toISOStrings(merged.take(4))).toEqual(single.take(4).map((date) => date.toISOString()));
      expect(toIndices(merged.take(0))).toEqual([]);
    });

    test('should work without any options', () => {
      const expression = CronExpressionParser.parseMany(['* * * * * *']);
      const result = expression.next();
      expect(result.date).toBeInstanceOf(CronDate);
      expect(result.indices).toEqual([0]);
    });
  });

  describe('options', () => {
    test('should apply tz to all expressions', () => {
      const expression = CronExpressionParser.parseMany(['0 9 * * *', '0 17 * * *'], {
        currentDate: '2024-01-15T00:00:00Z',
        tz: 'America/New_York',
      });

      const results = expression.take(2);
      // 9:00 and 17:00 in New York (EST, UTC-5)
      expect(toISOStrings(results)).toEqual(['2024-01-15T14:00:00.000Z', '2024-01-15T22:00:00.000Z']);
      expect(toIndices(results)).toEqual([[0], [1]]);
    });

    test('should stop all expressions at endDate', () => {
      const expression = CronExpressionParser.parseMany(['* * * * *', '30 * * * * *'], {
        currentDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-01T00:02:30Z',
      });

      const results = expression.take(10);
      expect(toISOStrings(results)).toEqual([
        '2024-01-01T00:00:30.000Z',
        '2024-01-01T00:01:00.000Z',
        '2024-01-01T00:01:30.000Z',
        '2024-01-01T00:02:00.000Z',
        '2024-01-01T00:02:30.000Z',
      ]);
      expect(toIndices(results)).toEqual([[1], [0], [1], [0], [1]]);
      expect(expression.hasNext()).toBe(false);
      expect(() => expression.next()).toThrow(TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE);
    });

    test('should stop all expressions at startDate when iterating backwards', () => {
      const expression = CronExpressionParser.parseMany(['* * * * *'], {
        currentDate: '2024-01-01T00:05:00Z',
        startDate: '2024-01-01T00:02:00Z',
      });

      const results = expression.take(-10);
      expect(toISOStrings(results)).toEqual([
        '2024-01-01T00:04:00.000Z',
        '2024-01-01T00:03:00.000Z',
        '2024-01-01T00:02:00.000Z',
      ]);
      expect(expression.hasPrev()).toBe(false);
      expect(() => expression.prev()).toThrow(TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE);
    });

    test('should clamp a currentDate before startDate to the start of the time span', () => {
      const expression = CronExpressionParser.parseMany(['0 12 * * *'], {
        currentDate: '2024-01-01T00:00:00Z',
        startDate: '2024-01-10T00:00:00Z',
      });

      expect(expression.next().date.toISOString()).toBe('2024-01-10T12:00:00.000Z');
    });

    test('should clamp a currentDate after endDate to the end of the time span', () => {
      const expression = CronExpressionParser.parseMany(['0 12 * * *'], {
        currentDate: '2024-01-20T00:00:00Z',
        endDate: '2024-01-10T00:00:00Z',
      });

      expect(expression.hasNext()).toBe(false);
      expect(expression.prev().date.toISOString()).toBe('2024-01-09T12:00:00.000Z');
    });

    test('should use startDate as the initial cursor when no currentDate is given', () => {
      const expression = CronExpressionParser.parseMany(['0 12 * * *'], {
        startDate: '2024-01-10T00:00:00Z',
      });

      expect(expression.next().date.toISOString()).toBe('2024-01-10T12:00:00.000Z');
    });
  });

  describe('next/prev interleaving', () => {
    test('should walk the same sequence when alternating next and prev', () => {
      const expression = CronExpressionParser.parseMany(['*/20 * * * *', '7 * * * *'], {
        currentDate: '2024-01-01T00:00:00Z',
      });

      const first = expression.next();
      const second = expression.next();

      const backToFirst = expression.prev();
      expect(backToFirst.date.toISOString()).toBe(first.date.toISOString());
      expect(backToFirst.indices).toEqual(first.indices);

      const secondAgain = expression.next();
      expect(secondAgain.date.toISOString()).toBe(second.date.toISOString());
      expect(secondAgain.indices).toEqual(second.indices);
    });

    test('should reproduce the same sequence after stepping back and forward again', () => {
      const expression = CronExpressionParser.parseMany(['*/20 * * * *', '7 * * * *'], {
        currentDate: '2024-01-01T00:00:00Z',
      });

      const forward = expression.take(5);
      expect(toISOStrings(forward)).toEqual([
        '2024-01-01T00:07:00.000Z',
        '2024-01-01T00:20:00.000Z',
        '2024-01-01T00:40:00.000Z',
        '2024-01-01T01:00:00.000Z',
        '2024-01-01T01:07:00.000Z',
      ]);
      expect(toIndices(forward)).toEqual([[1], [0], [0], [0], [1]]);

      expression.take(-5);
      const forwardAgain = expression.take(5);
      expect(toISOStrings(forwardAgain)).toEqual(toISOStrings(forward));
      expect(toIndices(forwardAgain)).toEqual(toIndices(forward));
    });

    test('should not advance the cursor when calling hasNext or hasPrev', () => {
      const expression = CronExpressionParser.parseMany(['* * * * *'], {
        currentDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-01T00:01:00Z',
      });

      expect(expression.hasNext()).toBe(true);
      expect(expression.hasNext()).toBe(true);
      expect(expression.next().date.toISOString()).toBe('2024-01-01T00:01:00.000Z');
      expect(expression.hasNext()).toBe(false);
      expect(expression.hasPrev()).toBe(true);
    });
  });

  describe('take', () => {
    test('should take steps backward with a negative limit', () => {
      const expression = CronExpressionParser.parseMany(['*/20 * * * *', '7 * * * *'], {
        currentDate: '2024-01-01T01:00:00Z',
      });

      const results = expression.take(-3);
      expect(toISOStrings(results)).toEqual([
        '2024-01-01T00:40:00.000Z',
        '2024-01-01T00:20:00.000Z',
        '2024-01-01T00:07:00.000Z',
      ]);
      expect(toIndices(results)).toEqual([[0], [0], [1]]);
    });

    test('should return an empty array when taking zero steps', () => {
      const expression = CronExpressionParser.parseMany(['* * * * *'], {
        currentDate: '2024-01-01T00:00:00Z',
      });
      expect(expression.take(0)).toEqual([]);
    });
  });

  describe('reset', () => {
    test('should restart the iteration as if a new collection was created', () => {
      const options = { currentDate: '2024-01-01T00:00:00Z' };
      const expression = CronExpressionParser.parseMany(['*/15 * * * *', '10 * * * *'], options);

      const expected = expression.take(4);
      expression.take(3);
      expression.reset();
      const actual = expression.take(4);

      expect(toISOStrings(actual)).toEqual(toISOStrings(expected));
      expect(toIndices(actual)).toEqual(toIndices(expected));
    });

    test('should reset to a given date', () => {
      const expressions = ['*/15 * * * *', '10 * * * *'];
      const expression = CronExpressionParser.parseMany(expressions, {
        currentDate: '2024-01-01T00:00:00Z',
      });
      const fresh = CronExpressionParser.parseMany(expressions, {
        currentDate: '2024-03-01T00:00:00Z',
      });

      expression.next();
      expression.reset(new Date('2024-03-01T00:00:00Z'));

      expect(expression.next().date.toISOString()).toBe(fresh.next().date.toISOString());
    });
  });
});
