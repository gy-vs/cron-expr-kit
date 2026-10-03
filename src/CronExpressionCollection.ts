import { CronDate } from './CronDate';
import { CronExpression, CronExpressionOptions, TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE } from './CronExpression';

/**
 * A single occurrence in a merged cron schedule.
 */
export type CronExpressionCollectionResult = {
  /** The trigger time. */
  date: CronDate;
  /**
   * Indices (into the expressions array passed to {@link CronExpressionParser.parseMany}) of every
   * expression that fires at {@link date}. Contains more than one index when several expressions
   * trigger at the same time.
   */
  indices: number[];
};

/**
 * Class representing several cron expressions iterated as a single merged schedule.
 *
 * Instances are created via {@link CronExpressionParser.parseMany}. Iteration yields each distinct
 * trigger time of the union of all underlying expressions in chronological order. When several
 * expressions trigger at the same time, that time is yielded once, carrying all of their indices.
 *
 * The merged iterator keeps a single cursor and re-anchors every underlying expression to it on
 * each step, so next() and prev() can be freely interleaved and always walk the same sequence.
 */
export class CronExpressionCollection {
  #options: CronExpressionOptions;
  readonly #tz?: string;
  readonly #expressions: CronExpression[];
  readonly #startDate: CronDate | null;
  readonly #endDate: CronDate | null;
  #currentDate: CronDate;

  /**
   * Creates a new CronExpressionCollection instance.
   *
   * @param {CronExpression[]} expressions - The parsed expressions to merge. They are expected to
   *   have been built with the same options (currentDate/startDate/endDate/tz).
   * @param {CronExpressionOptions} options - Parser options, same as for a single expression.
   */
  constructor(expressions: CronExpression[], options: CronExpressionOptions = {}) {
    this.#options = options;
    this.#tz = options.tz;
    this.#expressions = expressions;
    this.#startDate = options.startDate ? new CronDate(options.startDate, this.#tz) : null;
    this.#endDate = options.endDate ? new CronDate(options.endDate, this.#tz) : null;
    this.#currentDate = this.#getInitialDate();
  }

  /**
   * Computes the cursor position of a freshly created collection, applying the same clamping to
   * the [startDate, endDate] time span as CronExpression does.
   *
   * @returns {CronDate} The initial cursor position.
   * @private
   */
  #getInitialDate(): CronDate {
    let currentDateValue = this.#options.currentDate ?? this.#options.startDate;
    if (currentDateValue) {
      const tempCurrentDate = new CronDate(currentDateValue, this.#tz);
      if (this.#startDate && tempCurrentDate.getTime() < this.#startDate.getTime()) {
        currentDateValue = this.#startDate;
      } else if (this.#endDate && tempCurrentDate.getTime() > this.#endDate.getTime()) {
        currentDateValue = this.#endDate;
      }
    }
    return new CronDate(currentDateValue, this.#tz);
  }

  /**
   * Find the next trigger time of the merged schedule.
   * @returns {CronExpressionCollectionResult} The next trigger time and the indices of the expressions firing at it.
   * @memberof CronExpressionCollection
   * @public
   */
  next(): CronExpressionCollectionResult {
    return this.#findSchedule();
  }

  /**
   * Find the previous trigger time of the merged schedule.
   * @returns {CronExpressionCollectionResult} The previous trigger time and the indices of the expressions firing at it.
   * @memberof CronExpressionCollection
   * @public
   */
  prev(): CronExpressionCollectionResult {
    return this.#findSchedule(true);
  }

  /**
   * Check if there is a next trigger time in the merged schedule.
   * @returns {boolean} - Returns true if there is a next trigger time, false otherwise.
   * @memberof CronExpressionCollection
   * @public
   */
  hasNext(): boolean {
    const current = this.#currentDate;

    try {
      this.#findSchedule();
      return true;
    } catch {
      return false;
    } finally {
      this.#currentDate = current;
    }
  }

  /**
   * Check if there is a previous trigger time in the merged schedule.
   * @returns {boolean} - Returns true if there is a previous trigger time, false otherwise.
   * @memberof CronExpressionCollection
   * @public
   */
  hasPrev(): boolean {
    const current = this.#currentDate;

    try {
      this.#findSchedule(true);
      return true;
    } catch {
      return false;
    } finally {
      this.#currentDate = current;
    }
  }

  /**
   * Iterate over a specified number of steps.
   * @param {number} limit - The number of steps to iterate. Positive value iterates forward, negative value iterates backward.
   * @returns {CronExpressionCollectionResult[]} - The trigger times (and matching expression indices) in iteration order.
   * @memberof CronExpressionCollection
   * @public
   */
  take(limit: number): CronExpressionCollectionResult[] {
    const items: CronExpressionCollectionResult[] = [];
    if (limit >= 0) {
      for (let i = 0; i < limit; i++) {
        try {
          items.push(this.next());
        } catch {
          return items;
        }
      }
    } else {
      for (let i = 0; i > limit; i--) {
        try {
          items.push(this.prev());
        } catch {
          return items;
        }
      }
    }
    return items;
  }

  /**
   * Reset the iterator's cursor to a new date or, when omitted, to the same position a newly
   * created collection would start from.
   * @param {Date | CronDate} [newDate] - Optional new date to reset to. If not provided, the cursor is reset to the initial date.
   * @memberof CronExpressionCollection
   * @public
   */
  reset(newDate?: Date | CronDate): void {
    this.#currentDate = newDate ? new CronDate(newDate) : this.#getInitialDate();
  }

  /**
   * Finds the next or previous trigger time of the merged schedule.
   *
   * Every underlying expression is re-anchored to the collection cursor before being asked for
   * its next/previous occurrence, so the merged sequence only depends on the cursor and stays
   * consistent no matter how next() and prev() calls are interleaved.
   *
   * @param {boolean} [reverse=false] - If true, finds the previous trigger time; otherwise, finds the next one.
   * @returns {CronExpressionCollectionResult} - The trigger time and the indices of the expressions firing at it.
   * @private
   */
  #findSchedule(reverse = false): CronExpressionCollectionResult {
    let best: CronDate | null = null;
    let indices: number[] = [];

    for (let index = 0; index < this.#expressions.length; index++) {
      const expression = this.#expressions[index];
      expression.reset(this.#currentDate);

      let candidate: CronDate;
      try {
        candidate = reverse ? expression.prev() : expression.next();
      } catch {
        // This expression has no further occurrence within its time span; skip it.
        continue;
      }

      if (best === null) {
        best = candidate;
        indices = [index];
        continue;
      }

      const diff = candidate.getTime() - best.getTime();
      if (diff === 0) {
        // Several expressions trigger at the same time: report the time once, with all indices.
        indices.push(index);
      } else if (reverse ? diff > 0 : diff < 0) {
        best = candidate;
        indices = [index];
      }
    }

    if (best === null) {
      throw new Error(TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE);
    }

    // Store a private copy as the new cursor and hand out another one, so that mutating the
    // returned date cannot corrupt the iteration state.
    this.#currentDate = new CronDate(best);
    return { date: new CronDate(best), indices };
  }
}

export default CronExpressionCollection;
