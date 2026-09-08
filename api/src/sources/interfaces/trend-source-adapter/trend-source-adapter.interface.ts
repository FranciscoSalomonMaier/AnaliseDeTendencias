// src/sources/interfaces/trend-source-adapter.interface.ts

import { TrendItem } from '../trend-item/trend-item.interface';

export interface TrendSourceAdapter<TRaw> {
  normalize(item: TRaw): TrendItem;
}