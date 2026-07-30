function converterGigabitsEmTerabits(gigabits: bigint): bigint {
  return gigabits * BigInt(1e12);
}

export { converterGigabitsEmTerabits };
