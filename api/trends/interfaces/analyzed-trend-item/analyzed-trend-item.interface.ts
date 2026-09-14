import { TrendItem } from "src/sources/interfaces/trend-item/trend-item.interface";
import { TrendMetrics } from "../trend-metrics/trend-metrics.interface";

export interface AnalyzedTrendItem extends TrendItem {
    calculatedMetrics: TrendMetrics;
}
