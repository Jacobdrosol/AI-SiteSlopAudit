import type {
  Category,
  Check,
  CheckMeta,
  TargetKind,
} from "./types.js";

export class Registry {
  private checks: Check[] = [];

  register(check: Check): this {
    if (this.checks.some((c) => c.id === check.id)) {
      throw new Error(`Duplicate check id: ${check.id}`);
    }
    this.checks.push(check);
    return this;
  }

  registerAll(checks: Check[]): this {
    for (const c of checks) this.register(c);
    return this;
  }

  all(): Check[] {
    return [...this.checks];
  }

  forTarget(kind: TargetKind): Check[] {
    return this.checks.filter((c) => c.appliesTo.includes(kind));
  }

  get(id: string): Check | undefined {
    return this.checks.find((c) => c.id === id);
  }

  meta(): CheckMeta[] {
    return this.checks.map(
      ({ id, category, title, description, defaultSeverity, appliesTo, tags }) => ({
        id,
        category,
        title,
        description,
        defaultSeverity,
        appliesTo,
        tags,
      }),
    );
  }

  categoriesFor(kind: TargetKind): Category[] {
    return [
      ...new Set(this.forTarget(kind).map((c) => c.category)),
    ];
  }
}

export function defineCheck<C>(check: Check<C>): Check<C> {
  return check;
}
