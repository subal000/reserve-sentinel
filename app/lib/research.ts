// Generated from research/2026-09-16-cross-lender-exit (see its README for method
// and caveats). Regenerate rather than hand-editing.

export type PledgeRow = {
  symbol: string;
  mint: string;
  kamino: number;
  jupiter: number;
  pledged: number;
  sellable1: number;
  sellable5: number;
  sellable10: number;
  routeEndsAt: number | null;
};

export const STUDY = {
  "measuredAt": "2026-09-16T05:42:20Z",
  "rows": [
    {
      "symbol": "SPYx",
      "mint": "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
      "kamino": 4147407,
      "jupiter": 14083561,
      "pledged": 18230967,
      "sellable1": 1151496,
      "sellable5": 2084004,
      "sellable10": 2327306,
      "routeEndsAt": null
    },
    {
      "symbol": "QQQx",
      "mint": "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
      "kamino": 2745223,
      "jupiter": 1631857,
      "pledged": 4377080,
      "sellable1": 87584,
      "sellable5": 471910,
      "sellable10": 577916,
      "routeEndsAt": null
    },
    {
      "symbol": "TSLAx",
      "mint": "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
      "kamino": 2696311,
      "jupiter": 1548664,
      "pledged": 4244975,
      "sellable1": 194108,
      "sellable5": 502458,
      "sellable10": 531437,
      "routeEndsAt": 16000000
    },
    {
      "symbol": "NVDAx",
      "mint": "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
      "kamino": 2410326,
      "jupiter": 1472682,
      "pledged": 3883008,
      "sellable1": 218744,
      "sellable5": 509398,
      "sellable10": 582783,
      "routeEndsAt": null
    },
    {
      "symbol": "MSTRx",
      "mint": "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
      "kamino": 3849650,
      "jupiter": 0,
      "pledged": 3849650,
      "sellable1": 129290,
      "sellable5": 373358,
      "sellable10": 516458,
      "routeEndsAt": null
    },
    {
      "symbol": "GOOGLx",
      "mint": "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
      "kamino": 2769955,
      "jupiter": 0,
      "pledged": 2769955,
      "sellable1": 64345,
      "sellable5": 100000,
      "sellable10": 100000,
      "routeEndsAt": 250000
    },
    {
      "symbol": "CRCLx",
      "mint": "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
      "kamino": 840580,
      "jupiter": 0,
      "pledged": 840580,
      "sellable1": 272060,
      "sellable5": 702861,
      "sellable10": 1036654,
      "routeEndsAt": null
    },
    {
      "symbol": "HOODx",
      "mint": "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
      "kamino": 613475,
      "jupiter": 0,
      "pledged": 613475,
      "sellable1": 22886,
      "sellable5": 248444,
      "sellable10": 250000,
      "routeEndsAt": 500000
    },
    {
      "symbol": "AAPLx",
      "mint": "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
      "kamino": 460743,
      "jupiter": 0,
      "pledged": 460743,
      "sellable1": 79504,
      "sellable5": 250000,
      "sellable10": 250000,
      "routeEndsAt": 500000
    }
  ],
  "totals": {
    "pledged": 39270433,
    "sellable5": 5242433,
    "kamino": 20533670,
    "jupiter": 18736764,
    "coverage": 0.1335
  }
} as const;

export const PLEDGE_ROWS: readonly PledgeRow[] = STUDY.rows;
