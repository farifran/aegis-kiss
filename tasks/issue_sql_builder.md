# Issue: Implementação do Fluent Type-Safe SQL Query Builder & AST Engine (src/queryBuilder.ts)

## Descrição
Implementar um construtor de consultas SQL fluente, fortemente tipado com suporte a AST, parametrização segura e cláusulas complexas (SELECT, WHERE, JOIN, GROUP BY, HAVING, ORDER BY, LIMIT, OFFSET, INSERT, UPDATE, DELETE) em `src/queryBuilder.ts`.

---

### Task 1: Interfaces AST & SelectQueryBuilder Base
- **Demanda**: `crie modulo src/queryBuilder.ts com interfaces SQLWhereClause, SQLJoinClause e classe SelectQueryBuilder<T> contendo select, from, where, toSQL e re-exporte no src/index.ts sem extensoes .ts`

---

### Task 2: Cláusulas de Junção & Agrupamento
- **Demanda**: `adicione metodos join, leftJoin, groupBy, having, orderBy, limit, offset na classe SelectQueryBuilder em src/queryBuilder.ts`

---

### Task 3: Builders de Inserção, Atualização e Deleção (INSERT, UPDATE, DELETE)
- **Demanda**: `adicione classes InsertQueryBuilder<T>, UpdateQueryBuilder<T>, DeleteQueryBuilder<T> com toSQL e parametrizaçao em src/queryBuilder.ts`
