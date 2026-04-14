import { z } from 'zod';

export const sync_portfolio_state_schema = z
  .object({})
  .describe(
    'Synchronize all non-terminal portfolio positions, settle resolved markets into their corresponding event ledgers dynamically, and overwrite portfolio.json. This is a global Orchestrator tool. Call this exactly once before iterating through individual events so that all PMs receive up-to-date Nav slices.',
  );
