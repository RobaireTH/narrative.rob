import {
  ValidationAppError,
} from '../common/errors';

export type TradingMode = 'live' | 'paper';

export interface TradingPolicySummary {
  default_mode: TradingMode;
  effective_mode: TradingMode;
  live_trading_enabled: boolean;
  paper_trading_enabled: boolean;
}

export interface TradingPolicyServiceParams {
  default_mode: TradingMode;
  enable_live_trading: boolean;
  enable_paper_trading: boolean;
}

export class TradingPolicyService {
  private readonly default_mode: TradingMode;
  private readonly enable_live_trading: boolean;
  private readonly enable_paper_trading: boolean;

  constructor(params: TradingPolicyServiceParams) {
    this.default_mode = params.default_mode;
    this.enable_live_trading = params.enable_live_trading;
    this.enable_paper_trading = params.enable_paper_trading;
  }

  getPolicySummary(
    requested_mode?: TradingMode,
  ): TradingPolicySummary {
    const desired_mode = requested_mode ?? this.default_mode;

    if (desired_mode === 'live') {
      if (!this.enable_live_trading) {
        return {
          default_mode: this.default_mode,
          effective_mode: 'paper',
          live_trading_enabled: this.enable_live_trading,
          paper_trading_enabled: this.enable_paper_trading,
        };
      }

      return {
        default_mode: this.default_mode,
        effective_mode: 'live',
        live_trading_enabled: this.enable_live_trading,
        paper_trading_enabled: this.enable_paper_trading,
      };
    }

    if (!this.enable_paper_trading) {
      throw new ValidationAppError(
        'Paper trading was requested, but paper mode is disabled by policy.',
      );
    }

    return {
      default_mode: this.default_mode,
      effective_mode: 'paper',
      live_trading_enabled: this.enable_live_trading,
      paper_trading_enabled: this.enable_paper_trading,
    };
  }
}
