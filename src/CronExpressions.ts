import { CronDate } from './CronDate';
import { CronExpression, TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE } from './CronExpression';

/**
 * A single occurrence in a merged cron schedule: the trigger date together with the
 * indices of every expression (in the array passed to CronExpressionParser.parseMany)
 * that fires at that date.
 */
export type CronExpressionsResult = {
  date: CronDate;
  expressionIndices: number[];
};

/**
 * Class representing a merged schedule over multiple cron expressions.
 * Iterates the union of all expressions' trigger dates in chronological (or reverse
 * chronological) order. A date hit by several expressions is returned only once, with
 * every matching expression index attached.
 * Instances are created via CronExpressionParser.parseMany.
 */
export class CronExpressions {
  #expressions: CronExpression[];
  readonly #recreateExpressions: () => CronExpression[];
  #resetDate: Date | CronDate | undefined;
  // Buffered next (direction 1) or previous (direction -1) occurrence per expression, null when exhausted.
  #candidates: (CronDate | null)[] = [];
  #direction: -1 | 0 | 1 = 0;
  #lastDate: CronDate | null = null;
  // True while every expression sits at its base position (initial date or the last reset date).
  #positioned = true;

  /**
   * Creates a new CronExpressions instance.
   *
   * @param {CronExpression[]} expressions - The expressions to merge, in source order.
   * @param {() => CronExpression[]} recreateExpressions - Factory that recreates the expressions in their initial state.
   */
  constructor(expressions: CronExpression[], recreateExpressions: () => CronExpression[]) {
    this.#expressions = expressions;
    this.#recreateExpressions = recreateExpressions;
  }

  /**
   * Find the next scheduled date in the merged schedule.
   * @returns {CronExpressionsResult} - The next trigger date and the indices of the expressions that fire at it.
   * @memberof CronExpressions
   * @public
   */
  next(): CronExpressionsResult {
    return this.#findSchedule();
  }

  /**
   * Find the previous scheduled date in the merged schedule.
   * @returns {CronExpressionsResult} - The previous trigger date and the indices of the expressions that fire at it.
   * @memberof CronExpressions
   * @public
   */
  prev(): CronExpressionsResult {
    return this.#findSchedule(true);
  }

  /**
   * Check if there is a next scheduled date in the merged schedule.
   * @returns {boolean} - Returns true if there is a next scheduled date, false otherwise.
   * @memberof CronExpressions
   * @public
   */
  hasNext(): boolean {
    return this.#hasSchedule();
  }

  /**
   * Check if there is a previous scheduled date in the merged schedule.
   * @returns {boolean} - Returns true if there is a previous scheduled date, false otherwise.
   * @memberof CronExpressions
   * @public
   */
  hasPrev(): boolean {
    return this.#hasSchedule(true);
  }

  /**
   * Iterate over a specified number of steps in the merged schedule.
   * @param {number} limit - The number of steps to iterate. Positive value iterates forward, negative value iterates backward.
   * @returns {CronExpressionsResult[]} - The collected occurrences, in iteration order.
   * @memberof CronExpressions
   * @public
   */
  take(limit: number): CronExpressionsResult[] {
    const items: CronExpressionsResult[] = [];
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
   * Reset the iterator to a new date or to the initial date.
   * @param {Date | CronDate} [newDate] - Optional new date to reset to. If not provided, it will reset to the initial date.
   * @memberof CronExpressions
   * @public
   */
  reset(newDate?: Date | CronDate): void {
    if (newDate === undefined) {
      this.#expressions = this.#recreateExpressions();
      this.#resetDate = undefined;
    } else {
      for (const expression of this.#expressions) {
        expression.reset(newDate);
      }
      this.#resetDate = newDate;
    }
    this.#candidates = [];
    this.#direction = 0;
    this.#lastDate = null;
    this.#positioned = true;
  }

  /**
   * Returns the next (or previous) occurrence of a single expression, or null when the
   * expression has no further occurrence in that direction (e.g. outside its time span).
   *
   * @param {CronExpression} expression - The expression to advance.
   * @param {-1 | 1} direction - The direction to advance in.
   * @private
   * @returns {CronDate | null} The occurrence, or null when exhausted.
   */
  #advance(expression: CronExpression, direction: -1 | 1): CronDate | null {
    try {
      return direction === 1 ? expression.next() : expression.prev();
    } catch {
      return null;
    }
  }

  /**
   * (Re)positions every expression and recomputes the per-expression candidate buffer
   * for the given iteration direction.
   *
   * @param {-1 | 1} direction - The direction the buffer should serve.
   * @private
   */
  #computeCandidates(direction: -1 | 1): void {
    if (this.#lastDate !== null) {
      // Reposition every expression at the last emitted date so candidates are strictly
      // after (or before) it, regardless of how far each expression was advanced before.
      for (const expression of this.#expressions) {
        expression.reset(this.#lastDate);
      }
    } else if (!this.#positioned) {
      // No date emitted yet but the expressions were moved (e.g. by a hasNext/hasPrev
      // probe in the other direction); bring them back to their base position.
      if (this.#resetDate !== undefined) {
        for (const expression of this.#expressions) {
          expression.reset(this.#resetDate);
        }
      } else {
        this.#expressions = this.#recreateExpressions();
      }
    }
    this.#candidates = this.#expressions.map((expression) => this.#advance(expression, direction));
    this.#direction = direction;
    this.#positioned = false;
  }

  /**
   * Finds the next or previous merged occurrence.
   *
   * @param {boolean} [reverse=false] - If true, finds the previous occurrence; otherwise, finds the next one.
   * @private
   * @returns {CronExpressionsResult} - The trigger date and the indices of the expressions that fire at it.
   */
  #findSchedule(reverse = false): CronExpressionsResult {
    const direction: -1 | 1 = reverse ? -1 : 1;
    if (this.#direction !== direction) {
      this.#computeCandidates(direction);
    }

    let best: CronDate | null = null;
    for (const candidate of this.#candidates) {
      if (
        candidate !== null &&
        (best === null || (reverse ? candidate.getTime() > best.getTime() : candidate.getTime() < best.getTime()))
      ) {
        best = candidate;
      }
    }
    if (best === null) {
      throw new Error(TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE);
    }

    const bestTime = best.getTime();
    const expressionIndices: number[] = [];
    for (let index = 0; index < this.#candidates.length; index++) {
      const candidate = this.#candidates[index];
      if (candidate !== null && candidate.getTime() === bestTime) {
        expressionIndices.push(index);
        this.#candidates[index] = this.#advance(this.#expressions[index], direction);
      }
    }

    this.#lastDate = best;
    return { date: new CronDate(best), expressionIndices };
  }

  /**
   * Checks whether a next or previous merged occurrence exists without consuming it.
   *
   * @param {boolean} [reverse=false] - If true, checks the previous occurrence; otherwise, checks the next one.
   * @private
   * @returns {boolean} - True if such an occurrence exists.
   */
  #hasSchedule(reverse = false): boolean {
    const direction: -1 | 1 = reverse ? -1 : 1;
    if (this.#direction !== direction) {
      this.#computeCandidates(direction);
    }
    return this.#candidates.some((candidate) => candidate !== null);
  }
}

export default CronExpressions;
