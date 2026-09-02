// src/index.ts
import {
  OrderBook,
  type OrderSide,
  type BookOrder,
  type MatchTrade,
  type MatchResult
} from './orderBook.js';

import {
  MatchingEngine,
  type AccountBalance,
  type UserAccountState,
  type OrderCommand,
  type OrderExecutionStatus,
  type ExecutionReport,
  type EngineBatchResult,
  type EngineSnapshot
} from './matchingEngine.js';

export {
  OrderBook,
  MatchingEngine
};

export type {
  OrderSide,
  BookOrder,
  MatchTrade,
  MatchResult,
  AccountBalance,
  UserAccountState,
  OrderCommand,
  OrderExecutionStatus,
  ExecutionReport,
  EngineBatchResult,
  EngineSnapshot
};
