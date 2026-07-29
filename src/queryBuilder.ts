/* eslint-disable max-classes-per-file */
/**
 * Interfaces e Tipos da Árvore Sintática Abstrata (AST) SQL.
 */
export type SQLOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL';

export interface SQLWhereClause {
  field: string;
  operator: SQLOperator;
  value?: unknown;
  logic?: 'AND' | 'OR';
}

export interface SQLJoinClause {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  table: string;
  onLeft: string;
  operator: SQLOperator;
  onRight: string;
}

export interface SQLOrderByClause {
  field: string;
  direction: 'ASC' | 'DESC';
}

/**
 * Construtor Fluente para Consultas SELECT com Segurança de Tipos.
 */
export class SelectQueryBuilder<T> {
  private tableName = '';
  private selectedFields: string[] = [];
  private whereClauses: SQLWhereClause[] = [];
  private joinClauses: SQLJoinClause[] = [];
  private groupByFields: string[] = [];
  private havingClauses: SQLWhereClause[] = [];
  private orderByClauses: SQLOrderByClause[] = [];
  private limitCount?: number;
  private offsetCount?: number;

  select(...fields: Array<keyof T & string>): this {
    this.selectedFields = fields.length > 0 ? fields : ['*'];
    return this;
  }

  from(table: string): this {
    this.tableName = table;
    return this;
  }

  where(field: keyof T & string, operator: SQLOperator, value?: unknown): this {
    this.whereClauses.push({ field, operator, value, logic: 'AND' });
    return this;
  }

  orWhere(field: keyof T & string, operator: SQLOperator, value?: unknown): this {
    this.whereClauses.push({ field, operator, value, logic: 'OR' });
    return this;
  }

  join(table: string, onLeft: string, operator: SQLOperator, onRight: string): this {
    this.joinClauses.push({ type: 'INNER', table, onLeft, operator, onRight });
    return this;
  }

  leftJoin(table: string, onLeft: string, operator: SQLOperator, onRight: string): this {
    this.joinClauses.push({ type: 'LEFT', table, onLeft, operator, onRight });
    return this;
  }

  groupBy(...fields: Array<keyof T & string>): this {
    this.groupByFields = fields;
    return this;
  }

  having(field: string, operator: SQLOperator, value?: unknown): this {
    this.havingClauses.push({ field, operator, value, logic: 'AND' });
    return this;
  }

  orderBy(field: keyof T & string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.orderByClauses.push({ field, direction });
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }

  private buildWhereSql(params: unknown[]): string {
    if (this.whereClauses.length === 0) return '';
    const whereParts: string[] = [];
    for (let i = 0; i < this.whereClauses.length; i++) {
      const clause = this.whereClauses[i]!;
      const prefix = i === 0 ? '' : ` ${clause.logic ?? 'AND'} `;
      if (clause.operator === 'IS NULL' || clause.operator === 'IS NOT NULL') {
        whereParts.push(`${prefix}${clause.field} ${clause.operator}`);
      } else {
        params.push(clause.value);
        whereParts.push(`${prefix}${clause.field} ${clause.operator} ?$`);
      }
    }
    return ` WHERE ${whereParts.join('')}`;
  }

  toSQL(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const fieldsSql = this.selectedFields.length > 0 ? this.selectedFields.join(', ') : '*';
    let sql = `SELECT ${fieldsSql} FROM ${this.tableName}`;

    for (const join of this.joinClauses) {
      sql += ` ${join.type} JOIN ${join.table} ON ${join.onLeft} ${join.operator} ${join.onRight}`;
    }

    sql += this.buildWhereSql(params);

    if (this.groupByFields.length > 0) {
      sql += ` GROUP BY ${this.groupByFields.join(', ')}`;
    }

    if (this.havingClauses.length > 0) {
      const havingParts: string[] = [];
      for (let i = 0; i < this.havingClauses.length; i++) {
        const clause = this.havingClauses[i]!;
        params.push(clause.value);
        havingParts.push(`${clause.field} ${clause.operator} ?$`);
      }
      sql += ` HAVING ${havingParts.join(' AND ')}`;
    }

    if (this.orderByClauses.length > 0) {
      const orderParts = this.orderByClauses.map((o) => `${o.field} ${o.direction}`);
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    }

    if (this.limitCount !== undefined) {
      sql += ` LIMIT ${this.limitCount}`;
    }

    if (this.offsetCount !== undefined) {
      sql += ` OFFSET ${this.offsetCount}`;
    }

    return { sql, params };
  }
}

/**
 * Construtor para Operações INSERT.
 */
export class InsertQueryBuilder<T> {
  private tableName = '';
  private data: Partial<T> = {};

  into(table: string): this {
    this.tableName = table;
    return this;
  }

  values(values: Partial<T>): this {
    this.data = values;
    return this;
  }

  toSQL(): { sql: string; params: unknown[] } {
    const keys = Object.keys(this.data);
    const params = Object.values(this.data);
    const placeholders = keys.map(() => '?$').join(', ');
    const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`;
    return { sql, params };
  }
}

/**
 * Construtor para Operações UPDATE.
 */
export class UpdateQueryBuilder<T> {
  private tableName = '';
  private data: Partial<T> = {};
  private whereField = '';
  private whereValue: unknown;

  table(table: string): this {
    this.tableName = table;
    return this;
  }

  set(values: Partial<T>): this {
    this.data = values;
    return this;
  }

  where(field: keyof T & string, value: unknown): this {
    this.whereField = field;
    this.whereValue = value;
    return this;
  }

  toSQL(): { sql: string; params: unknown[] } {
    const keys = Object.keys(this.data);
    const setParams = Object.values(this.data);
    const setSql = keys.map((k) => `${k} = ?$` ).join(', ');
    const params = [...setParams, this.whereValue];
    const sql = `UPDATE ${this.tableName} SET ${setSql} WHERE ${this.whereField} = ?$`;
    return { sql, params };
  }
}

/**
 * Construtor para Operações DELETE.
 */
export class DeleteQueryBuilder<T> {
  private tableName = '';
  private whereField = '';
  private whereValue: unknown;

  from(table: string): this {
    this.tableName = table;
    return this;
  }

  where(field: keyof T & string, value: unknown): this {
    this.whereField = field;
    this.whereValue = value;
    return this;
  }

  toSQL(): { sql: string; params: unknown[] } {
    const sql = `DELETE FROM ${this.tableName} WHERE ${this.whereField} = ?$`;
    return { sql, params: [this.whereValue] };
  }
}
