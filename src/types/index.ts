// ── Market & City Types ───────────────────────────────────────
export interface Threshold {
  value: number;
  high?: number;
  unit: 'F' | 'C';
  type: 'range' | 'below' | 'above' | 'exact';
}

export interface Outcome {
  name: string;
  title: string;
  conditionId?: string;
  tokenId?: string;
  price: number;
  noPrice: number;
  threshold: Threshold | null;
  volume: number;
  closed?: boolean;
}

export interface Market {
  eventSlug?: string;
  title: string;
  endDate?: string;
  polymarketUrl?: string;
  outcomes: Outcome[];
  thresholds: Threshold[];
}

export interface City {
  name: string;
  slug: string;
  country: string;
  activeMarket?: Market | null;
  polymarketUrl?: string;
  hasApiData?: boolean;
  marketsByDate?: Record<string, Market | null>;
}

export interface MultiDayData {
  dates: string[];
  cities: City[];
}

// ── Analysis Types ────────────────────────────────────────────
export interface BracketProbability {
  name: string;
  title?: string;
  forecastProb: number | null;
  marketPrice?: number;
  edge?: number;
}

export interface Edge {
  bracketProbabilities?: BracketProbability[];
  ensembleSpread?: number;
  reasoning?: string;
  modelDivergence?: ModelDivergence;
  signal?: string;
}

export interface ModelDivergence {
  isDivergent: boolean;
  summary?: string;
  gfsTemp?: number;
  ecmwfTemp?: number;
  difference?: number;
  warmerModel?: string;
}

export interface Atmospheric {
  humidity?: number;
  dewPoint?: number;
  windSpeed?: number;
  windGusts?: number;
  windDirection?: number;
  pressure?: number;
  cloudCover?: number;
  visibility?: number;
  precipProbability?: number;
  dewPointDepression?: number;
}

export interface AirQuality {
  usAqi?: number;
  uvIndex?: number;
  pm25?: number;
  ozone?: number;
}

export interface SpreadScore {
  score: number;
}

export interface TrajectoryPoint {
  daysAgo: number;
  modelRunDate: string;
  forecastedMaxTemp?: number;
  maxTemp?: number; // legacy
}

export interface StationBias {
  bias: number;
  stdDev?: number;
  sampleSize: number;
  reliable: boolean;
  direction?: 'warm' | 'cold' | 'neutral';
}

export interface LiveWeather {
  currentTemp: number;
  maxToday: number;
  lastUpdated?: string;
  icao?: string;
  stationName?: string;
  rawMETAR?: string;
  wundergroundUrl?: string;
}

export interface BaseRate {
  values: number[];
  rate?: number;
  sampleSize?: number;
  years?: number;
}

export interface EnsembleData {
  timeSteps?: EnsembleTimeStep[];
  memberCount?: number;
  averageSpread?: number;
  bracketProbabilities?: BracketProbability[];
  rawBracketProbabilities?: BracketProbability[];
  preFactorBracketProbabilities?: BracketProbability[];
  memberMaxes?: number[];
  bmaBlend?: any;
}

export interface EnsembleTimeStep {
  time: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MultiModelConsensus {
  predictions?: ModelPrediction[];
  agreementRatio: number;
  allAgree: boolean;
  medianTemp?: number;
  modelCount?: number;
  isWeighted?: boolean;
}

export interface ModelPrediction {
  model: string;
  maxTemp: number | null;
  exceedsThreshold?: boolean;
  deviation?: number;
  weight?: number;
}

export interface StrategyBet {
  bracket: string;
  pctOfPortfolio: number;
  entryPrice: number;
  forecastProb: string;
  edge: string;
  expectedReturn: string;
  potentialReturn?: string;
  maxLoss?: string;
  isHedge?: boolean;
  marketYesPrice?: number;
  edgeNo?: string;
  profitPerShare?: string;
}

export interface StrategySummary {
  winProbability: number;
  expectedReturn: number;
  maxDrawdown: number;
  totalDeployed: number;
  totalYesPct: number;
  totalNoPct: number;
  totalLongshotPct: number;
  totalFadePct?: number;
  confidence: number;
  daysOut: number;
}

export interface Strategy {
  yesBets: StrategyBet[];
  noBets: StrategyBet[];
  longshots: StrategyBet[];
  overpricedNoBets?: StrategyBet[];
  summary: StrategySummary;
  arbitrage?: { isArbitrage: boolean; sumYesPrices: number; profitIfArb: number };
}

export interface ModelConfig {
  region?: string;
  ensemble?: string[];
  ensembleWeights?: Record<string, number>;
  deterministic?: { model: string; weight: number }[];
  deterministicSlugs?: string[];
  modelWeights?: Record<string, number>;
}

export interface CityInfo {
  station?: string;
  icao?: string;
  matchedKey?: string;
  lat?: number;
  lon?: number;
}

export interface AdvancedFactor {
  factor: string;
  adjustment: number;
  confidence: number;
  reasoning: string;
  pattern?: string;
  data?: any;
}

export interface AdvancedFactors {
  factors: AdvancedFactor[];
  netAdjustment: number;
  netConfidence: number;
  dominantFactor: string | null;
  activeFactorCount: number;
}

export interface FactorBracketShift {
  name: string;
  tempC?: number;
  originalProb: number;
  adjustedProb: number;
  shift: number;
}

export interface FactorBreakdown {
  netAdjustment: number;
  netConfidence: number;
  effectiveShift: number;
  shiftFraction: number;
  shiftDirection: 'WARMING' | 'COOLING';
  activeFactors: { factor: string; adjustment: number; confidence: number; reasoning: string }[];
  perBracket: FactorBracketShift[];
}

export interface AnalysisData {
  market?: Market;
  city?: CityInfo;
  cityInfo?: City;
  targetDate?: string;
  daysUntilResolution?: number;
  modelConfig?: ModelConfig;
  ensemble?: EnsembleData;
  multiModel?: { consensus?: MultiModelConsensus; models?: any[] };
  baseRate?: BaseRate;
  edge?: Edge;
  modelDivergence?: ModelDivergence;
  atmospheric?: Atmospheric;
  airQuality?: AirQuality;
  forecastSkill?: any;
  spreadScore?: SpreadScore;
  stationBias?: StationBias;
  trajectory?: TrajectoryPoint[];
  liveWeather?: LiveWeather;
  advancedFactors?: AdvancedFactors;
  factorAdjustment?: FactorBreakdown;
  strategy?: Strategy;
  error?: string;
}

// ── WebSocket Types ───────────────────────────────────────────
export interface WsPriceUpdate {
  type: 'price_update';
  tokenId: string;
  name: string;
  price: number;
  change: number;
  bid?: number;
  ask?: number;
}

export interface WsOfiUpdate {
  type: 'ofi_update';
  ofi: number;
  timestamp: number;
}

export type WsMessage = WsPriceUpdate | WsOfiUpdate | { type: string; [key: string]: any };

// ── Paper Trading Types ──────────────────────────────────────
export interface HCPosition {
  temp: number;
  label: string;
  netCost: number;
  netShares: number;
  redeemed: number;
  trades: number;
}

export interface HCCityData {
  city: string;
  unit: string;
  yesPositions: HCPosition[];
  noPositions: HCPosition[];
  totalYesCost: number;
  totalNoCost: number;
  totalCost: number;
  totalRedeemed: number;
  estimatedPnl: number;
  tradeCount: number;
  mainYesBracket?: string;
  mainYesPrice?: number;
}

export interface PaperAnalysisCity {
  city: string;
  cityName?: string;
  ens: PaperStrategy;
  fcst: PaperStrategy;
  samePick?: boolean;
  allBrackets?: PaperBracket[];
}

export interface PaperStrategy {
  yesBracket: string;
  yesProb: string;
  yesPrice: string;
  yesEdge: number;
  noBrackets: string[];
  expectedProfit: number;
  expectedROI: string;
  totalCost: number;
}

export interface PaperBracket {
  name: string;
  mkt: string;
  ens: string;
  fcst: string;
}

export interface PaperAnalysis {
  cities: PaperAnalysisCity[];
  allCityNames: string[];
  totalEnsExpectedProfit: string;
  totalFcstExpectedProfit: string;
  error?: string;
}

// ── Paper Trade Records ──────────────────────────────────────
export interface PaperTrade {
  id: string;
  city: string;
  cityName: string;
  date: string;
  bracket: string;
  side: 'YES' | 'NO';
  entryPrice: number;
  shares: number;
  cost: number;
  forecastProb: number;
  status: 'PENDING' | 'WON' | 'LOST';
  pnl: number;
  entryTime: string;
  source: 'ENS' | 'FCST';
}

export interface PaperPortfolio {
  startingBalance: number;
  balance: number;
  deployed: number;
  available: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  events: number;
}

export interface HondaAllData {
  dates: Record<string, HCCityData[]>;
}
