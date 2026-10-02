// scripts/snapshot.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// src/data/params.json
var params_default = {
  meta: {
    currency: "EUR",
    constructionStart: "2027-01-01",
    openingDate: "2028-01-01",
    capexMonths: 12,
    opsMonths: 60,
    mode: "\u0414\u0430",
    scenario: "Base",
    vatMode: "\u0413\u0440\u043E\u0441\u0441"
  },
  general: {
    rubEurRate: 100,
    inflation: 0.025,
    wacc: 0.14
  },
  taxes: {
    cit: 0.125,
    vatStd: 0.19,
    vatGlamp: 0.09,
    vatFb: 0.09,
    vatInput: 0.19,
    employerRate: 0.1515,
    sdc: 0.17,
    gesy: 0.0265
  },
  prices: {
    membershipMonth: 200,
    membershipYear: 1500,
    certificate: 150,
    fbPerGuest: 10,
    glampSmall: 165,
    glampBig: 235
  },
  units: {
    glampSmall: 2,
    glampBig: 1,
    annualMembersPlan: [
      30,
      50,
      80,
      120,
      120
    ],
    certsPerMonth: 65,
    presaleMonths: 3,
    presaleMode: "deferred",
    presaleRecognizeMonths: 12
  },
  amort: {
    shares: [
      0.4,
      0.45,
      0.15
    ],
    years: [
      10,
      7,
      5
    ],
    groups: [
      "\u041C\u043E\u0434\u0443\u043B\u0438/\u043A\u043E\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u0438",
      "\u041E\u0431\u043E\u0440\u0443\u0434\u043E\u0432\u0430\u043D\u0438\u0435",
      "\u041F\u0440\u043E\u0447\u0435\u0435"
    ]
  },
  opexPct: {
    acquiring: 0.02,
    maintenance: 0.03
  },
  fb: {
    enabled: true,
    foodCostPct: 0.35,
    cookSalary: 1500,
    cookCount: 1
  },
  land: {
    mode: "owned",
    purchaseCost: 8e4,
    rentMonthly: 800
  },
  preopen: {
    enabled: true,
    months: 2
  },
  members: {
    consumeSlots: true,
    visitsPerMonth: 2,
    partySize: 2
  },
  taxDepr: {
    enabled: true,
    years: [25, 7, 5]
  },
  glampOta: {
    enabled: true,
    share: 0.3,
    commissionPct: 0.17
  },
  tv: {
    enabled: false,
    growth: 0.025
  },
  deposit: {
    base: 110,
    steamBase: 50,
    massageBase: 60,
    policy: "\u041D\u0435\u0441\u0433\u043E\u0440\u0430\u0435\u043C\u044B\u0439 \u0437\u0430 \u044E\u043D\u0438\u0442\u043E\u043C"
  },
  kpi: {
    steamShare: 0.3,
    massageShare: 0.3,
    revenueShare: 0.01
  },
  service: {
    upgradeShare: 0,
    walletExtraShare: 0.2,
    demandMult: 1,
    serviceLoads: true
  },
  seasonality: {
    baths: [
      1.25,
      1.2,
      1.1,
      1.05,
      0.9,
      0.7,
      1,
      0.65,
      0.9,
      1.2,
      1.25,
      1
    ],
    glamping: [
      0.3,
      0.4,
      0.7,
      1.1,
      1.2,
      1.1,
      0.8,
      0.8,
      1.1,
      1.2,
      0.6,
      0.3
    ]
  },
  procedures: {
    steam: {
      names: [
        "\u041F\u0430\u0440\u0435\u043D\u0438\u0435 \u2014 \u041A\u043B\u0430\u0441\u0441\u0438\u043A\u0430",
        "\u041F\u0430\u0440\u0435\u043D\u0438\u0435 \u2014 \u0414\u0443\u0431\u043B\u044C",
        "\u041F\u0430\u0440\u0435\u043D\u0438\u0435 \u2014 \u0410\u0444\u0440\u043E\u0434\u0438\u0442\u0430",
        "\u041F\u0430\u0440\u0435\u043D\u0438\u0435 \u2014 \u0411\u043E\u0433\u0438 \u041E\u043B\u0438\u043C\u043F\u0430"
      ],
      prices: [
        50,
        70,
        150,
        250
      ],
      weights: [
        0.4,
        0.3,
        0.2,
        0.1
      ]
    },
    massage: {
      names: [
        "\u041C\u0430\u0441\u0441\u0430\u0436 1 (\u0431\u0430\u0437\u043E\u0432\u044B\u0439)",
        "\u041C\u0430\u0441\u0441\u0430\u0436 2 (\u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u0439)",
        "\u041C\u0430\u0441\u0441\u0430\u0436 3 (\u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u043D\u044B\u0439)",
        "\u041C\u0430\u0441\u0441\u0430\u0436 4 (\u043F\u0440\u0435\u043C\u0438\u0443\u043C)"
      ],
      prices: [
        60,
        100,
        150,
        200
      ],
      weights: [
        0.3,
        0.35,
        0.2,
        0.15
      ]
    },
    extra: {
      names: [
        "\u041B\u0435\u0434\u044F\u043D\u0430\u044F \u041A\u0443\u043F\u0435\u043B\u044C",
        "\u041F\u0438\u0445\u0442\u043E\u0432\u0430\u044F \u041A\u0443\u043F\u0435\u043B\u044C",
        "\u0422\u0440\u0430\u0432\u044F\u043D\u043E\u0439 \u0427\u0430\u043D",
        "\u0412\u0430\u043D\u043D\u0430 \u041A\u043B\u0435\u043E\u043F\u0430\u0442\u0440\u044B",
        "\u041C\u0430\u0433\u043D\u0438\u0435\u0432\u0430\u044F \u0432\u0430\u043D\u043D\u0430",
        "\u041D\u0430\u0441\u0442\u0438\u043B \u043D\u0430 \u043F\u043E\u043B\u043E\u0433\u0438",
        "\u041D\u0430\u0441\u0442\u0438\u043B \u0432\u043E \u0432\u0441\u0435\u0439 \u0431\u0430\u043D\u0438"
      ],
      prices: [
        150,
        150,
        150,
        500,
        250,
        120,
        250
      ],
      weights: [
        2,
        2,
        2,
        1,
        1.5,
        3,
        1
      ]
    }
  },
  partners: {
    names: [
      "\u041F\u0430\u0440\u0442\u043D\u0451\u0440 1",
      "\u041F\u0430\u0440\u0442\u043D\u0451\u0440 2",
      "\u041F\u0430\u0440\u0442\u043D\u0451\u0440 3"
    ],
    shares: [
      0.267,
      0.267,
      0.266
    ],
    statuses: [
      "\u0420\u0435\u0437\u0438\u0434\u0435\u043D\u0442 \u041A\u0438\u043F\u0440\u0430 (17%)",
      "\u0420\u0435\u0437\u0438\u0434\u0435\u043D\u0442 \u041A\u0438\u043F\u0440\u0430 (17%)",
      "\u0420\u0435\u0437\u0438\u0434\u0435\u043D\u0442 \u041A\u0438\u043F\u0440\u0430 (17%)"
    ],
    corporate: {
      mgmt: 0.1,
      reserve: 0.1
    }
  },
  modules: [
    {
      id: 1,
      status: "\u0410\u043A\u0442\u0438\u0432\u0435\u043D",
      launchDate: "2028-01-01",
      uptime: 0.95,
      loadK: 1,
      slotsPerDay: 4,
      capacity: 4,
      prices: [
        250,
        350,
        400,
        500
      ],
      avgPrice: null
    },
    {
      id: 2,
      status: "\u0410\u043A\u0442\u0438\u0432\u0435\u043D",
      launchDate: "2028-01-01",
      uptime: 0.95,
      loadK: 1,
      slotsPerDay: 4,
      capacity: 8,
      prices: [
        500,
        700,
        800,
        1e3
      ],
      avgPrice: null
    },
    {
      id: 3,
      status: "\u0410\u043A\u0442\u0438\u0432\u0435\u043D",
      launchDate: "2028-01-01",
      uptime: 0.95,
      loadK: 1,
      slotsPerDay: 4,
      capacity: 12,
      prices: [
        750,
        1050,
        1200,
        1500
      ],
      avgPrice: null
    },
    {
      id: 4,
      status: "\u0412 \u0440\u0435\u0437\u0435\u0440\u0432\u0435",
      launchDate: "2029-01-01",
      uptime: 0.95,
      loadK: 1,
      slotsPerDay: 4,
      capacity: 6,
      prices: [
        375,
        525,
        600,
        750
      ],
      avgPrice: null
    },
    {
      id: 5,
      status: "\u0412 \u0440\u0435\u0437\u0435\u0440\u0432\u0435",
      launchDate: "2029-01-01",
      uptime: 0.95,
      loadK: 1,
      slotsPerDay: 4,
      capacity: 6,
      prices: [
        375,
        525,
        600,
        750
      ],
      avgPrice: null
    },
    {
      id: 6,
      status: "\u0412 \u0440\u0435\u0437\u0435\u0440\u0432\u0435",
      launchDate: "2029-01-01",
      uptime: 0.95,
      loadK: 1,
      slotsPerDay: 4,
      capacity: 6,
      prices: [
        375,
        525,
        600,
        750
      ],
      avgPrice: null
    }
  ],
  slotMix: [
    0.15,
    0.15,
    0.3,
    0.4
  ],
  slotNames: [
    "\u0414\u043E\u043B\u044F \u0441\u043F\u0440\u043E\u0441\u0430 \u2014 \u0423\u0442\u0440\u0435\u043D\u043D\u0438\u0439 \u0441\u043B\u043E\u0442",
    "\u0414\u043E\u043B\u044F \u0441\u043F\u0440\u043E\u0441\u0430 \u2014 \u0414\u043D\u0435\u0432\u043D\u043E\u0439 \u0441\u043B\u043E\u0442 1",
    "\u0414\u043E\u043B\u044F \u0441\u043F\u0440\u043E\u0441\u0430 \u2014 \u0414\u043D\u0435\u0432\u043D\u043E\u0439 \u0441\u043B\u043E\u0442 2",
    "\u0414\u043E\u043B\u044F \u0441\u043F\u0440\u043E\u0441\u0430 \u2014 \u0412\u0435\u0447\u0435\u0440\u043D\u0438\u0439 \u0441\u043B\u043E\u0442"
  ],
  opexFixed: [
    {
      name: "\u041C\u0430\u0440\u043A\u0435\u0442\u0438\u043D\u0433 \u0438 \u0440\u0435\u043A\u043B\u0430\u043C\u0430",
      base: 5e3
    },
    {
      name: "\u042D\u043B\u0435\u043A\u0442\u0440\u043E\u044D\u043D\u0435\u0440\u0433\u0438\u044F",
      base: 3e3
    },
    {
      name: "\u0412\u043E\u0434\u043E\u0441\u043D\u0430\u0431\u0436\u0435\u043D\u0438\u0435",
      base: 800
    },
    {
      name: "\u041E\u0442\u043E\u043F\u043B\u0435\u043D\u0438\u0435 (\u0433\u0430\u0437)",
      base: 300
    },
    {
      name: "\u0422\u0440\u0430\u043D\u0441\u043F\u043E\u0440\u0442",
      base: 300
    },
    {
      name: "\u041F\u0440\u043E\u0447\u0438\u0435 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0435",
      base: 600
    },
    {
      name: "\u0421\u0442\u0440\u0430\u0445\u043E\u0432\u0430\u043D\u0438\u0435",
      base: 1e3
    },
    {
      name: "\u0411\u0443\u0445\u0433\u0430\u043B\u0442\u0435\u0440\u0438\u044F / \u044E\u0440\u0438\u0441\u0442",
      base: 400
    },
    {
      name: "\u041E\u0431\u0441\u043B\u0443\u0436\u0438\u0432\u0430\u043D\u0438\u0435 \u043C\u043E\u0434\u0443\u043B\u0435\u0439",
      base: 100,
      perModule: true
    }
  ],
  fot: {
    roles: [
      "\u041F\u0430\u0440\u043C\u0430\u0441\u0442\u0435\u0440",
      "\u041C\u0430\u0441\u0441\u0430\u0436\u0438\u0441\u0442",
      "\u0410\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440",
      "\u0425\u0430\u0443\u0441\u043C\u0435\u043D",
      "\u0423\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0449\u0438\u0439",
      "\u0411\u0440\u043E\u043D\u0438\u0441\u0442",
      "\u041A\u043B\u0438\u043D\u0435\u0440 (\u0433\u043E\u0440\u043D\u0438\u0447\u043D\u0430\u044F)",
      "\u0418\u043D\u0436\u0435\u043D\u0435\u0440",
      "\u041F\u043E\u043C\u043E\u0449\u043D\u0438\u043A \u043F\u0430\u0440\u043C\u0430\u0441\u0442\u0435\u0440\u0430"
    ],
    count: [
      6,
      4,
      2,
      2,
      1,
      1,
      2,
      1,
      2
    ],
    salary: [
      1800,
      1500,
      1200,
      1200,
      2500,
      1320,
      1050,
      2200,
      1350
    ]
  },
  capexItems: [
    {
      name: "\u041C\u043E\u0434\u0443\u043B\u044C\u043D\u044B\u0435 \u0434\u043E\u043C\u0430",
      unit: "\u0448\u0442",
      qty: 3,
      priceRub: 9e6,
      row: 6
    },
    {
      name: "\u0411\u0430\u043D\u043D\u044B\u0435 \u043C\u043E\u0434\u0443\u043B\u044F (\u041A\u043E\u043C\u043F\u043B\u0435\u043A\u0441\u044B)",
      unit: "\u0448\u0442",
      qty: "MODULES_COUNT",
      priceRub: 7e6,
      row: 7
    },
    {
      name: "\u041F\u0435\u0447\u043D\u043E\u0435 \u043E\u0431\u043E\u0440\u0443\u0434\u043E\u0432\u0430\u043D\u0438\u0435",
      unit: "\u0448\u0442",
      qty: 3,
      priceRub: 25e4,
      row: 8
    },
    {
      name: "\u0412\u043E\u0434\u043E\u0435\u043C\u044B \u041A\u0443\u043F\u0435\u043B\u0438 \u0445\u043E\u043B\u043E\u0434",
      unit: "\u0448\u0442",
      qty: 3,
      priceRub: 25e4,
      row: 9
    },
    {
      name: "\u0412\u043E\u0434\u043E\u0435\u043C\u044B \u041A\u0443\u043F\u0435\u043B\u0438 \u0433\u043E\u0440\u044F\u0447",
      unit: "\u0448\u0442",
      qty: 3,
      priceRub: 5e5,
      row: 10
    },
    {
      name: "\u0412\u0430\u043D\u043D\u044B \u0410\u0444\u0440\u043E\u0434\u0438\u0442\u044B",
      unit: "\u0448\u0442",
      qty: 6,
      priceRub: 1e6,
      row: 11
    },
    {
      name: "\u041A\u0443\u043F\u0435\u043B\u0438 \u043B\u0435\u0434\u044F\u043D\u044B\u0435",
      unit: "\u0448\u0442",
      qty: 2,
      priceRub: 1e6,
      row: 12
    },
    {
      name: "\u0421\u043D\u0435\u0436\u043D\u0430\u044F \u041A\u043E\u043C\u043D\u0430\u0442\u0430",
      unit: "\u0448\u0442",
      qty: 1,
      priceRub: 25e5,
      row: 13
    },
    {
      name: "\u042D\u043B\u0435\u043A\u0442\u0440\u043E \u043A\u043E\u043C\u043C\u0443\u043D\u0438\u043A\u0430\u0446\u0438\u0438 (\u041D\u042D\u0421)",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 6e6,
      row: 14
    },
    {
      name: "\u042D\u043B\u0435\u043A\u0442\u0440\u043E \u043A\u043E\u043C\u043C\u0443\u043D\u0438\u043A\u0430\u0446\u0438\u0438 (\u0412\u042D\u0421)",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 4e6,
      row: 15
    },
    {
      name: "\u0421\u043E\u043B\u043D\u0435\u0447\u043D\u044B\u0435 \u043F\u0430\u043D\u0435\u043B\u0438",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 3e6,
      row: 16
    },
    {
      name: "\u0412\u043E\u0434\u044F\u043D\u044B\u0435 \u043A\u043E\u043C\u043C\u0443\u043D\u0438\u043A\u0430\u0446\u0438\u0438 \u041D\u0412\u041A",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 2e6,
      row: 17
    },
    {
      name: "\u0412\u043E\u0434\u044F\u043D\u044B\u0435 \u043A\u043E\u043C\u043C\u0443\u043D\u0438\u043A\u0430\u0446\u0438\u0438 \u0412\u0412\u041A",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 2e6,
      row: 18
    },
    {
      name: "\u0414\u0438\u0437\u0430\u0439\u043D \u0438 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u043A\u043E\u043D\u0446\u0435\u043F\u0446\u0438\u0438",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 25e5,
      row: 19
    },
    {
      name: "\u041F\u0440\u043E\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u041A\u043E\u043C\u043F\u043B\u0435\u043A\u0441\u0430",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 3e6,
      row: 20
    },
    {
      name: "\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430\u0446\u0438\u044F",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 35e5,
      row: 21
    },
    {
      name: "\u041C\u0430\u0440\u043A\u0435\u0442\u0438\u043D\u0433 \u0411\u0440\u0435\u043D\u0434\u0438\u043D\u0433",
      unit: "\u043C\u0435\u0441",
      qty: 24,
      priceRub: 25e4,
      row: 22
    },
    {
      name: "\u0410\u0432\u0442\u043E\u0440\u0441\u043A\u0438\u0439 \u043D\u0430\u0434\u0437\u043E\u0440",
      unit: "\u043C\u0435\u0441",
      qty: 12,
      priceRub: 5e5,
      row: 23
    },
    {
      name: "\u0421\u0442\u0440\u043E\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0440\u0430\u0431\u043E\u0442\u044B",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 3e7,
      row: 24
    },
    {
      name: "\u041E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0421\u0442\u0440\u043E\u0438\u0442\u0435\u043B\u044C\u0441\u0442\u0432\u0430",
      unit: "\u043C\u0435\u0441",
      qty: 12,
      priceRub: 22e4,
      row: 25
    },
    {
      name: "\u041A\u043E\u043C\u0438\u0441\u0441\u0438\u044F \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0449\u0435\u0439 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 97994,
      row: 26
    },
    {
      name: "\u0422\u0440\u0430\u043D\u0441\u043F\u043E\u0440\u0442\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u044B",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 5e6,
      row: 27
    },
    {
      name: "\u041D\u0435\u043F\u0440\u0435\u0434\u0432\u0438\u0434\u0435\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u044B",
      unit: "\u043C\u0435\u0441",
      qty: 12,
      priceRub: 37e4,
      row: 28
    },
    {
      name: "\u041A\u043E\u043C\u0438\u0441\u0441\u0438\u044F \u0437\u0430 \u043F\u0440\u043E\u0435\u043A\u0442 \u043E\u0442 \u0441\u0442\u0440\u043E\u0439\u043A\u0438",
      unit: "\u043E\u0431\u0449",
      qty: 1,
      priceRub: 184e4,
      row: 29
    },
    {
      name: "\u041D\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 (\u043C\u0435\u0431\u0435\u043B\u044C, \u043E\u0431\u043E\u0440\u0443\u0434\u043E\u0432\u0430\u043D\u0438\u0435) \u2014 \u0438\u0437 \u041D\u043E\u043C\u0435\u043D\u043A\u043B\u0430\u0442\u0443\u0440\u044B",
      unit: "\u043E\u0431\u0449",
      qty: null,
      priceRub: null,
      row: 30
    },
    {
      name: "\u0411\u043B\u0430\u0433\u043E\u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E",
      unit: "\u043E\u0431\u0449",
      qty: 0,
      priceRub: 0,
      row: 31
    }
  ],
  it: {
    enabled: true,
    curator: 2500,
    opex: [
      {
        name: "\u0425\u043E\u0441\u0442\u0438\u043D\u0433 \u0438 \u043E\u0431\u043B\u0430\u0447\u043D\u0430\u044F \u0438\u043D\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430",
        base: 400
      },
      {
        name: "\u041F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0430 \u0438 \u043C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433 (MSP)",
        base: 500
      },
      {
        name: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D\u0438\u044F \u0438 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442",
        base: 150
      },
      {
        name: "\u041E\u0444\u0438\u0441\u043D\u044B\u0435 SaaS (\u043F\u043E\u0447\u0442\u0430, \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B)",
        base: 80
      },
      {
        name: "\u0418\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B \u043C\u0430\u0440\u043A\u0435\u0442\u0438\u043D\u0433\u0430 / SMM",
        base: 100
      },
      {
        name: "\u0414\u043E\u043C\u0435\u043D\u044B, SSL, \u043C\u0435\u043B\u043A\u0438\u0435 \u0441\u0435\u0440\u0432\u0438\u0441\u044B",
        base: 50
      },
      {
        name: "\u0420\u0435\u0437\u0435\u0440\u0432 \u043D\u0430 \u0441\u043A\u0440\u044B\u0442\u044B\u0435 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438",
        base: 250
      }
    ],
    capex: [
      {
        name: "IT: \u0441\u0435\u0442\u044C, WiFi, \u0432\u0438\u0434\u0435\u043E\u043D\u0430\u0431\u043B\u044E\u0434\u0435\u043D\u0438\u0435",
        eur: 12e3
      },
      {
        name: "IT: POS, \u043F\u043B\u0430\u043D\u0448\u0435\u0442\u044B, \u041F\u041A, \u043F\u0440\u0438\u043D\u0442\u0435\u0440\u044B",
        eur: 15e3
      },
      {
        name: "IT: \u043A\u0430\u0441\u0442\u043E\u043C\u043D\u044B\u0439 \u0441\u043B\u043E\u0439 (\u0431\u0443\u043A\u0438\u043D\u0433+CRM+\u0443\u0447\u0451\u0442+\u0441\u0430\u0439\u0442)",
        eur: 55e3
      },
      {
        name: "IT: \u0432\u043D\u0435\u0434\u0440\u0435\u043D\u0438\u0435, \u043C\u0438\u0433\u0440\u0430\u0446\u0438\u044F, \u043E\u0431\u0443\u0447\u0435\u043D\u0438\u0435",
        eur: 13e3
      }
    ]
  }
};

// src/data/scenarios.json
var scenarios_default = {
  names: [
    "Conservative",
    "Base",
    "Aggressive"
  ],
  baths: {
    y1: [
      0.35,
      0.5,
      0.65
    ],
    y2: [
      0.45,
      0.6,
      0.75
    ],
    y3: [
      0.55,
      0.7,
      0.85
    ],
    y4: [
      0.57,
      0.72,
      0.87
    ],
    y5: [
      0.6,
      0.75,
      0.9
    ]
  },
  steam: {
    y1: [
      0.35,
      0.5,
      0.65
    ],
    y3: [
      0.65,
      0.85,
      0.95
    ]
  },
  massage: {
    y1: [
      0.2,
      0.3,
      0.45
    ],
    y3: [
      0.45,
      0.65,
      0.8
    ]
  },
  glamping: {
    y1: [
      0.2,
      0.4,
      0.6
    ],
    y3: [
      0.45,
      0.65,
      0.8
    ]
  },
  membersMonth: {
    y1: [
      20,
      50,
      80
    ],
    y3: [
      70,
      120,
      180
    ]
  },
  priceGrowth: [
    0.03,
    0.03,
    0.05
  ],
  capexAdj: [
    0.15,
    0,
    0
  ],
  rampMonths: [
    12,
    9,
    6
  ],
  uptake: [
    0.2,
    0.3,
    0.4
  ]
};

// src/data/nomenclature.json
var nomenclature_default = [
  {
    code: "NC-001",
    name: "\u0412\u0435\u043D\u0438\u043A \u0434\u0443\u0431\u043E\u0432\u044B\u0439",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 10,
    deliveryFix: 2.35,
    deliveryPct: 0,
    use: "OPEX",
    opexArticle: "\u0412\u0435\u043D\u0438\u043A\u0438",
    norm: 0.25,
    normBase: "\u0441\u043B\u043E\u0442",
    qty: 0,
    note: "~\u20AC3.09/\u0441\u043B\u043E\u0442 = \u20AC667/\u043C\u0435\u0441 @60%"
  },
  {
    code: "NC-002",
    name: "\u0414\u0440\u043E\u0432\u0430 \u0434\u0443\u0431/\u0433\u0440\u0430\u0431",
    category: "\u0422\u043E\u043F\u043B\u0438\u0432\u043E",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043C\xB3",
    price: 150,
    deliveryFix: 23.61,
    deliveryPct: 0,
    use: "OPEX",
    opexArticle: "\u0414\u0440\u043E\u0432\u0430 \u043E\u0441\u043D\u043E\u0432\u043D\u044B\u0435",
    norm: 0.06,
    normBase: "\u0441\u043B\u043E\u0442",
    qty: 0,
    note: "\u20AC150/\u043C\xB3 bulk \u041A\u0438\u043F\u0440 (\u0438\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u0435); \u0440\u043E\u0437\u043D\u0438\u0446\u0430 \u0434\u0443\u0431 ~\u20AC270\u2013320/\u043C\xB3 \u0441 \u041D\u0414\u0421 (pyrsos.com). ~\u20AC10.42/\u0441\u043B\u043E\u0442"
  },
  {
    code: "NC-003",
    name: "\u0414\u0440\u043E\u0432\u0430 \u0430\u043A\u0430\u0446\u0438\u044F (\u043E\u0447\u0430\u0433)",
    category: "\u0422\u043E\u043F\u043B\u0438\u0432\u043E",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043C\xB3",
    price: 130,
    deliveryFix: 22.78,
    deliveryPct: 0,
    use: "OPEX",
    opexArticle: "\u0414\u0440\u043E\u0432\u0430 \u0434\u043B\u044F \u043E\u0447\u0430\u0433\u0430",
    norm: 0.02,
    normBase: "\u0441\u043B\u043E\u0442",
    qty: 0,
    note: "\u20AC110/\u043C\xB3 \u0430\u043A\u0430\u0446\u0438\u044F \u0434\u043B\u044F \u043E\u0447\u0430\u0433\u0430 (\u0438\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u0435, 6 \u043C\xB3/\u043C\u0435\u0441). ~\u20AC3.06/\u0441\u043B\u043E\u0442"
  },
  {
    code: "NC-004",
    name: "\u0411\u0440\u0438\u043A\u0435\u0442\u044B RUF",
    category: "\u0422\u043E\u043F\u043B\u0438\u0432\u043E",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043C\xB3",
    price: 170,
    deliveryFix: 33.7,
    deliveryPct: 0,
    use: "OPEX",
    opexArticle: "\u0411\u0440\u0438\u043A\u0435\u0442\u044B \u0440\u0443\u0444",
    norm: 0.12,
    normBase: "\u0441\u043B\u043E\u0442",
    qty: 0,
    note: "~\u20AC24.44/\u0441\u043B\u043E\u0442 = \u20AC5280/\u043C\u0435\u0441 @60%"
  },
  {
    code: "NC-005",
    name: "\u041D\u0430\u0431\u043E\u0440 \u0433\u0438\u0433\u0438\u0435\u043D\u044B (\u0448\u0430\u043C\u043F\u0443\u043D\u044C/\u0433\u0435\u043B\u044C)",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 8,
    deliveryFix: 1.98,
    deliveryPct: 0,
    use: "OPEX",
    opexArticle: "\u0421\u0440\u0435\u0434\u0441\u0442\u0432\u0430 \u0433\u0438\u0433\u0438\u0435\u043D\u044B",
    norm: 0.116,
    normBase: "\u0441\u043B\u043E\u0442",
    qty: 0,
    note: "~\u20AC1.16/\u0441\u043B\u043E\u0442 = \u20AC250/\u043C\u0435\u0441 @60%"
  },
  {
    code: "NC-006",
    name: "\u041A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430 SPA-\u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 40,
    deliveryFix: 6.3,
    deliveryPct: 0,
    use: "OPEX",
    opexArticle: "\u041A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430 / SPA",
    norm: 0.05,
    normBase: "\u0441\u043B\u043E\u0442",
    qty: 0,
    note: "~\u20AC2.31/\u0441\u043B\u043E\u0442 = \u20AC500/\u043C\u0435\u0441 @60%"
  },
  {
    code: "NC-007",
    name: "\u041C\u0430\u0441\u043B\u043E \u043C\u0430\u0441\u0441\u0430\u0436\u043D\u043E\u0435",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 40,
    deliveryFix: 6.3,
    deliveryPct: 0,
    use: "OPEX",
    opexArticle: "\u041A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430 / \u043C\u0430\u0441\u0441\u0430\u0436",
    norm: 0.025,
    normBase: "\u0441\u043B\u043E\u0442",
    qty: 0,
    note: "~\u20AC1.16/\u0441\u043B\u043E\u0442 = \u20AC250/\u043C\u0435\u0441 @60%"
  },
  {
    code: "NC-008",
    name: "\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C \u0443\u0431\u043E\u0440\u043E\u0447\u043D\u044B\u0439",
    category: "\u0425\u0438\u043C\u0438\u044F \u0438 \u0443\u0431\u043E\u0440\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 8,
    deliveryFix: 2.07,
    deliveryPct: 0,
    use: "OPEX",
    opexArticle: "\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C / \u0443\u0431\u043E\u0440\u043A\u0430",
    norm: 0.023,
    normBase: "\u0441\u043B\u043E\u0442",
    qty: 0,
    note: "~\u20AC0.23/\u0441\u043B\u043E\u0442 = \u20AC50/\u043C\u0435\u0441 @60%"
  },
  {
    code: "NC-009",
    name: "\u041F\u0440\u0430\u0447\u0435\u0447\u043D\u0430\u044F/\u0442\u0435\u043A\u0441\u0442\u0438\u043B\u044C (\u0443\u0441\u043B\u0443\u0433\u0430)",
    category: "\u0422\u0435\u043A\u0441\u0442\u0438\u043B\u044C",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 16,
    deliveryFix: 3.96,
    deliveryPct: 0,
    use: "OPEX",
    opexArticle: "\u041F\u0440\u0430\u0447\u0435\u0447\u043D\u0430\u044F / \u0442\u0435\u043A\u0441\u0442\u0438\u043B\u044C",
    norm: 0.116,
    normBase: "\u0441\u043B\u043E\u0442",
    qty: 0,
    note: "~\u20AC2.31/\u0441\u043B\u043E\u0442 = \u20AC500/\u043C\u0435\u0441 @60%"
  },
  {
    code: "NC-010",
    name: "\u041F\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043B\u044C\u0441\u043A\u0438\u0439 \u043D\u0430\u0431\u043E\u0440 \u0433\u043E\u0441\u0442\u044F",
    category: "\u041F\u0440\u043E\u0447\u0435\u0435",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 5.4,
    deliveryFix: 0.5,
    deliveryPct: 0,
    use: "OPEX",
    opexArticle: "\u041F\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043B\u044C\u0441\u043A\u0438\u0435",
    norm: 1,
    normBase: "\u0433\u043E\u0441\u0442\u044C",
    qty: 0,
    note: "\u20AC5.9/\u0433\u043E\u0441\u0442\u044C \u2014 \u043A\u0430\u043A \u043F\u0440\u0435\u0436\u0434\u0435"
  },
  {
    code: "NC-101",
    name: "\u041C\u0435\u0431\u0435\u043B\u044C \u043B\u0430\u0443\u043D\u0436-\u0437\u043E\u043D\u044B (\u043A\u043E\u043C\u043F\u043B)",
    category: "\u041C\u0435\u0431\u0435\u043B\u044C",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 2500,
    deliveryFix: 0,
    deliveryPct: 0.12,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u043F\u0440\u0438\u043C\u0435\u0440: \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u043A\u043E\u043B-\u0432\u043E"
  },
  {
    code: "NC-102",
    name: "\u0428\u0435\u0437\u043B\u043E\u043D\u0433",
    category: "\u041C\u0435\u0431\u0435\u043B\u044C",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 180,
    deliveryFix: 0,
    deliveryPct: 0.15,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u043F\u0440\u0438\u043C\u0435\u0440: \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u043A\u043E\u043B-\u0432\u043E"
  },
  {
    code: "NC-103",
    name: "\u0414\u0435\u043A\u043E\u0440 \u0438 \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u044B \u0438\u043D\u0442\u0435\u0440\u044C\u0435\u0440\u0430",
    category: "\u0418\u043D\u0442\u0435\u0440\u044C\u0435\u0440",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 3e3,
    deliveryFix: 0,
    deliveryPct: 0.1,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u043F\u0440\u0438\u043C\u0435\u0440: \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u043A\u043E\u043B-\u0432\u043E"
  },
  {
    code: "NC-104",
    name: "\u041F\u043E\u0441\u0443\u0434\u0430 \u0438 \u043F\u0438\u0442\u0435\u0439\u043D\u044B\u0439 \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C",
    category: "\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 1500,
    deliveryFix: 0,
    deliveryPct: 0.1,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u043F\u0440\u0438\u043C\u0435\u0440: \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u043A\u043E\u043B-\u0432\u043E"
  },
  {
    code: "NC-020",
    name: "\u0412\u0435\u043D\u0438\u043A \u0434\u0443\u0431 \u043A\u0430\u043D\u0430\u0434\u0441\u043A\u0438\u0439 \u043F\u0440\u0435\u043C\u0438\u0443\u043C",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 2.2,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u041B\u0438\u0442\u0432\u0430, \u0437\u0430\u043A\u0443\u043F"
  },
  {
    code: "NC-021",
    name: "\u0412\u0435\u043D\u0438\u043A \u0434\u0443\u0431 \u043A\u0430\u0432\u043A\u0430\u0437\u0441\u043A\u0438\u0439",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 1.8,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u041B\u0438\u0442\u0432\u0430, \u0437\u0430\u043A\u0443\u043F"
  },
  {
    code: "NC-022",
    name: "\u0412\u0435\u043D\u0438\u043A \u0431\u0435\u0440\u0451\u0437\u0430",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 1.3,
    deliveryFix: 0.35,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u041B\u0438\u0442\u0432\u0430, \u0437\u0430\u043A\u0443\u043F"
  },
  {
    code: "NC-023",
    name: "\u0412\u0435\u043D\u0438\u043A \u043F\u0438\u0445\u0442\u0430",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 2,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u041B\u0438\u0442\u0432\u0430, \u0437\u0430\u043A\u0443\u043F"
  },
  {
    code: "NC-024",
    name: "\u0412\u0435\u043D\u0438\u043A \u043C\u043E\u0436\u0436\u0435\u0432\u0435\u043B\u044C\u043D\u0438\u043A",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 2.2,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u041B\u0438\u0442\u0432\u0430, \u0437\u0430\u043A\u0443\u043F"
  },
  {
    code: "NC-025",
    name: "\u0412\u0435\u043D\u0438\u043A \u044D\u0432\u043A\u0430\u043B\u0438\u043F\u0442",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 2,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u041B\u0438\u0442\u0432\u0430, \u0437\u0430\u043A\u0443\u043F"
  },
  {
    code: "NC-026",
    name: "\u0412\u0435\u043D\u0438\u043A \u043B\u0438\u043F\u0430",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 1.8,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-027",
    name: "\u0412\u0435\u043D\u0438\u043A \u043A\u0440\u0430\u043F\u0438\u0432\u0430",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 1.8,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-030",
    name: "\u0421\u0431\u043E\u0440 \u0442\u0440\u0430\u0432 \u0434\u043E\u043D\u043D\u0438\u043A",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 18,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-031",
    name: "\u0421\u0431\u043E\u0440 \u0442\u0440\u0430\u0432 \u043F\u043E\u043B\u044B\u043D\u044C",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 18,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-032",
    name: "\u0421\u0431\u043E\u0440 \u0442\u0440\u0430\u0432 \u043C\u044F\u0442\u0430",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 15,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-033",
    name: "\u0421\u0431\u043E\u0440 \u0442\u0440\u0430\u0432 \u0447\u0430\u0431\u0440\u0435\u0446/\u0442\u0438\u043C\u044C\u044F\u043D",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 16,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-034",
    name: "\u0421\u0431\u043E\u0440 \u0442\u0440\u0430\u0432 \u0440\u043E\u043C\u0430\u0448\u043A\u0430",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 15,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-035",
    name: "\u0421\u0431\u043E\u0440 \u0442\u0440\u0430\u0432 \u043B\u0438\u043F\u0430 (\u0446\u0432\u0435\u0442)",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 16,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-036",
    name: "\u0421\u0431\u043E\u0440 \u0442\u0440\u0430\u0432 \u043C\u0435\u043B\u0438\u0441\u0441\u0430",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 16,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-037",
    name: "\u0421\u0431\u043E\u0440 \u0442\u0440\u0430\u0432 \u0431\u043E\u0433\u0443\u043B\u044C\u043D\u0438\u043A",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 17,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-038",
    name: "\u042D\u0444\u0438\u0440\u043D\u044B\u0435 \u043C\u0430\u0441\u043B\u0430 \u0434\u043B\u044F \u043F\u0430\u0440\u043E\u0433\u0435\u043D\u0435\u0440\u0430\u0442\u043E\u0440\u0430",
    category: "\u0411\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 45,
    deliveryFix: 6,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-040",
    name: "\u0421\u043E\u043B\u044C \u043C\u043E\u0440\u0441\u043A\u0430\u044F (\u0441\u043A\u0440\u0430\u0431)",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 3,
    deliveryFix: 0.6,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-041",
    name: "\u041C\u0451\u0434 \u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u043D\u044B\u0439",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 12,
    deliveryFix: 1.5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-042",
    name: "\u0412\u043E\u0434\u043E\u0440\u043E\u0441\u043B\u0438 \u043B\u0430\u043C\u0438\u043D\u0430\u0440\u0438\u044F/\u0444\u0443\u043A\u0443\u0441",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 30,
    deliveryFix: 4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-043",
    name: "\u041A\u043E\u0444\u0435 \u043C\u043E\u043B\u043E\u0442\u044B\u0439 (\u0441\u043A\u0440\u0430\u0431)",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 10,
    deliveryFix: 1.5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-044",
    name: "\u041C\u0430\u0441\u043B\u043E \u043A\u043E\u043A\u043E\u0441\u043E\u0432\u043E\u0435",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 12,
    deliveryFix: 1.5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-045",
    name: "\u041C\u0430\u0441\u043B\u043E \u043C\u0438\u043D\u0434\u0430\u043B\u044C\u043D\u043E\u0435 \u0431\u0430\u0437\u043E\u0432\u043E\u0435",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 14,
    deliveryFix: 1.5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-046",
    name: "\u041C\u0430\u0441\u043B\u043E \u043A\u0430\u043A\u0430\u043E",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 20,
    deliveryFix: 2.5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-047",
    name: "\u0421\u043F\u0438\u0440\u0442 \u043C\u0435\u0434\u0438\u0446\u0438\u043D\u0441\u043A\u0438\u0439 (\u043E\u0433\u043D\u0435\u043D\u043D\u044B\u0439 \u043C\u0430\u0441\u0441\u0430\u0436)",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 8,
    deliveryFix: 1,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-048",
    name: "\u041C\u0430\u0441\u043A\u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043F\u0440\u043E\u0444.",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 4,
    deliveryFix: 0.5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-049",
    name: "\u0410\u0440\u043E\u043C\u0430\u043F\u0430\u043B\u043E\u0447\u043A\u0438 \u043F\u0440\u0435\u043C\u0438\u0443\u043C",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0443\u043F",
    price: 6,
    deliveryFix: 0.8,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-050",
    name: "\u0421\u0432\u0435\u0447\u0438 \u0441\u043E\u0435\u0432\u044B\u0435 \u043C\u0430\u0441\u0441\u0430\u0436\u043D\u044B\u0435",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 8,
    deliveryFix: 1,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-051",
    name: "\u0422\u0440\u0443\u0441\u044B \u043E\u0434\u043D\u043E\u0440\u0430\u0437\u043E\u0432\u044B\u0435 \u043C/\u0436",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 0.3,
    deliveryFix: 0.05,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-052",
    name: "\u041B\u0438\u0444\u0447\u0438\u043A \u043E\u0434\u043D\u043E\u0440\u0430\u0437\u043E\u0432\u044B\u0439",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 0.4,
    deliveryFix: 0.05,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-053",
    name: "\u0428\u0430\u043F\u043E\u0447\u043A\u0438 \u043E\u0434\u043D\u043E\u0440\u0430\u0437\u043E\u0432\u044B\u0435",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 0.15,
    deliveryFix: 0.03,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-054",
    name: "\u0422\u0430\u043F\u043E\u0447\u043A\u0438 \u043E\u0434\u043D\u043E\u0440\u0430\u0437\u043E\u0432\u044B\u0435",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 0.5,
    deliveryFix: 0.08,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-055",
    name: "\u0411\u0440\u0438\u0442\u0432\u0435\u043D\u043D\u044B\u0435 \u043D\u0430\u0431\u043E\u0440\u044B \u043E\u0434\u043D\u043E\u0440\u0430\u0437\u043E\u0432\u044B\u0435",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 0.6,
    deliveryFix: 0.08,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-056",
    name: "\u0420\u0430\u0441\u0447\u0451\u0441\u043A\u0438 \u043E\u0434\u043D\u043E\u0440\u0430\u0437\u043E\u0432\u044B\u0435",
    category: "\u0421\u041F\u0410 \u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 0.25,
    deliveryFix: 0.04,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-060",
    name: "\u041B\u0451\u0434 \u0434\u043B\u044F \u043A\u0443\u043F\u0435\u043B\u0438",
    category: "\u0412\u043E\u0434\u043E\u0451\u043C\u044B \u0438 \u0445\u0438\u043C\u0438\u044F",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 0.4,
    deliveryFix: 0.1,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "200 \u043A\u0433 \u043D\u0430 \u0437\u0430\u043F\u0440\u0430\u0432\u043A\u0443"
  },
  {
    code: "NC-061",
    name: "\u041C\u043E\u043B\u043E\u043A\u043E \u0441\u0443\u0445\u043E\u0435 (\u0432\u0430\u043D\u043D\u0430 \u041A\u043B\u0435\u043E\u043F\u0430\u0442\u0440\u044B)",
    category: "\u0412\u043E\u0434\u043E\u0451\u043C\u044B \u0438 \u0445\u0438\u043C\u0438\u044F",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 8,
    deliveryFix: 1,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-062",
    name: "\u041B\u0435\u043F\u0435\u0441\u0442\u043A\u0438 \u0446\u0432\u0435\u0442\u043E\u0432",
    category: "\u0412\u043E\u0434\u043E\u0451\u043C\u044B \u0438 \u0445\u0438\u043C\u0438\u044F",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 10,
    deliveryFix: 1.5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-063",
    name: "\u041C\u0430\u0433\u043D\u0438\u0435\u0432\u0430\u044F \u0441\u043E\u043B\u044C",
    category: "\u0412\u043E\u0434\u043E\u0451\u043C\u044B \u0438 \u0445\u0438\u043C\u0438\u044F",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 2.5,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-064",
    name: "\u0422\u0440\u0430\u0432\u044F\u043D\u0430\u044F \u0437\u0430\u043F\u0440\u0430\u0432\u043A\u0430 \u0434\u043B\u044F \u0447\u0430\u043D\u0430",
    category: "\u0412\u043E\u0434\u043E\u0451\u043C\u044B \u0438 \u0445\u0438\u043C\u0438\u044F",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 18,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-065",
    name: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u043A\u0438\u0441\u043B\u043E\u0440\u043E\u0434 (\u0434\u0435\u0437\u0438\u043D\u0444\u0435\u043A\u0446\u0438\u044F)",
    category: "\u0412\u043E\u0434\u043E\u0451\u043C\u044B \u0438 \u0445\u0438\u043C\u0438\u044F",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 9,
    deliveryFix: 1.2,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-066",
    name: "\u0410\u043B\u044C\u0433\u0438\u0446\u0438\u0434",
    category: "\u0412\u043E\u0434\u043E\u0451\u043C\u044B \u0438 \u0445\u0438\u043C\u0438\u044F",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 10,
    deliveryFix: 1.2,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-067",
    name: "\u041A\u043E\u0430\u0433\u0443\u043B\u044F\u043D\u0442/\u0444\u043B\u043E\u043A\u0443\u043B\u044F\u043D\u0442",
    category: "\u0412\u043E\u0434\u043E\u0451\u043C\u044B \u0438 \u0445\u0438\u043C\u0438\u044F",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 10,
    deliveryFix: 1.2,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-068",
    name: "\u0422\u0435\u0441\u0442-\u043F\u043E\u043B\u043E\u0441\u043A\u0438 pH",
    category: "\u0412\u043E\u0434\u043E\u0451\u043C\u044B \u0438 \u0445\u0438\u043C\u0438\u044F",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0443\u043F",
    price: 8,
    deliveryFix: 1,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-070",
    name: "\u0413\u0435\u043B\u044C \u0434\u043B\u044F \u0434\u0443\u0448\u0430 (\u043A\u0430\u043D\u0438\u0441\u0442\u0440\u0430)",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 6,
    deliveryFix: 0.8,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-071",
    name: "\u0428\u0430\u043C\u043F\u0443\u043D\u044C (\u043A\u0430\u043D\u0438\u0441\u0442\u0440\u0430)",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 7,
    deliveryFix: 0.9,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-072",
    name: "\u041A\u043E\u043D\u0434\u0438\u0446\u0438\u043E\u043D\u0435\u0440 \u0434\u043B\u044F \u0432\u043E\u043B\u043E\u0441 (\u043A\u0430\u043D\u0438\u0441\u0442\u0440\u0430)",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 7,
    deliveryFix: 0.9,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-073",
    name: "\u041C\u044B\u043B\u043E \u0436\u0438\u0434\u043A\u043E\u0435 (\u043A\u0430\u043D\u0438\u0441\u0442\u0440\u0430)",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 5,
    deliveryFix: 0.7,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-074",
    name: "\u041C\u0438\u0446\u0435\u043B\u043B\u044F\u0440\u043D\u0430\u044F \u0432\u043E\u0434\u0430",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 15,
    deliveryFix: 2,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-075",
    name: "\u041A\u0440\u0435\u043C \u0434\u043B\u044F \u0442\u0435\u043B\u0430 \u043F\u043E\u0441\u043B\u0435 \u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 25,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-076",
    name: "\u0412\u0430\u0442\u043D\u044B\u0435 \u043F\u0430\u043B\u043E\u0447\u043A\u0438/\u0434\u0438\u0441\u043A\u0438",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0443\u043F",
    price: 2,
    deliveryFix: 0.3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-077",
    name: "\u0417\u0443\u0431\u043D\u043E\u0439 \u043D\u0430\u0431\u043E\u0440 \u0438\u043D\u0434\u0438\u0432\u0438\u0434\u0443\u0430\u043B\u044C\u043D\u044B\u0439",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 0.8,
    deliveryFix: 0.1,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-078",
    name: "\u0422\u0443\u0430\u043B\u0435\u0442\u043D\u0430\u044F \u0431\u0443\u043C\u0430\u0433\u0430 \u043F\u0440\u0435\u043C\u0438\u0443\u043C",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0443\u043F",
    price: 4,
    deliveryFix: 0.6,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-079",
    name: "\u0412\u043B\u0430\u0436\u043D\u044B\u0435 \u0441\u0430\u043B\u0444\u0435\u0442\u043A\u0438 \u0441\u0430\u0448\u0435",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0443\u043F",
    price: 5,
    deliveryFix: 0.7,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-080",
    name: "\u041D\u0430\u043A\u043B\u0430\u0434\u043A\u0438 \u043D\u0430 \u0443\u043D\u0438\u0442\u0430\u0437",
    category: "\u0413\u0438\u0433\u0438\u0435\u043D\u0430 \u0438 \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0443\u043F",
    price: 3,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-085",
    name: "\u0421\u0440\u0435\u0434\u0441\u0442\u0432\u043E \u0434\u043B\u044F \u0440\u043E\u0437\u0436\u0438\u0433\u0430",
    category: "\u0422\u043E\u043F\u043B\u0438\u0432\u043E",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0443\u043F",
    price: 6,
    deliveryFix: 0.8,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-086",
    name: "\u0413\u0430\u0437\u043E\u0432\u044B\u0439 \u0431\u0430\u043B\u043B\u043E\u043D (\u0433\u043E\u0440\u0435\u043B\u043A\u0430)",
    category: "\u0422\u043E\u043F\u043B\u0438\u0432\u043E",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 4,
    deliveryFix: 0.6,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-090",
    name: "\u0427\u0430\u0439 \u043B\u0438\u0441\u0442\u043E\u0432\u043E\u0439 \u043F\u0440\u0435\u043C\u0438\u0443\u043C",
    category: "F&B",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 40,
    deliveryFix: 5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-091",
    name: "\u041C\u0451\u0434 \u0434\u043B\u044F \u0447\u0430\u0439\u043D\u043E\u0439 \u0437\u043E\u043D\u044B",
    category: "F&B",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 12,
    deliveryFix: 1.5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-092",
    name: "\u0412\u0430\u0440\u0435\u043D\u044C\u0435 \u043F\u043E\u0440\u0446\u0438\u043E\u043D\u043D\u043E\u0435",
    category: "F&B",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 8,
    deliveryFix: 1,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-093",
    name: "\u0421\u0443\u0445\u043E\u0444\u0440\u0443\u043A\u0442\u044B (\u043C\u0438\u043A\u0441)",
    category: "F&B",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 10,
    deliveryFix: 1.2,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-094",
    name: "\u041E\u0440\u0435\u0445\u043E\u0432\u044B\u0435 \u0441\u043C\u0435\u0441\u0438",
    category: "F&B",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 16,
    deliveryFix: 2,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-095",
    name: "\u0421\u043D\u0435\u043A\u0438/\u0441\u0443\u0448\u043A\u0438/\u043F\u0430\u0441\u0442\u0438\u043B\u0430",
    category: "F&B",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 8,
    deliveryFix: 1,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-096",
    name: "\u0424\u0440\u0443\u043A\u0442\u044B \u0441\u0432\u0435\u0436\u0438\u0435",
    category: "F&B",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 2,
    deliveryFix: 0.3,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-097",
    name: "\u0412\u043E\u0434\u0430 \u043F\u0438\u0442\u044C\u0435\u0432\u0430\u044F 0.5\u043B",
    category: "F&B",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 0.4,
    deliveryFix: 0.05,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-098",
    name: "\u042D\u043A\u043E-\u0441\u0442\u0430\u043A\u0430\u043D\u0447\u0438\u043A\u0438/\u0441\u0430\u043B\u0444\u0435\u0442\u043A\u0438/\u0441\u0430\u0445\u0430\u0440-\u0441\u0442\u0438\u043A\u0438",
    category: "F&B",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 3,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-150",
    name: "\u0425\u0438\u043C\u0438\u044F \u0434\u043B\u044F \u0434\u0440\u0435\u0432\u0435\u0441\u0438\u043D\u044B \u043F\u0430\u0440\u043D\u043E\u0439",
    category: "\u0425\u0438\u043C\u0438\u044F \u0438 \u0443\u0431\u043E\u0440\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 12,
    deliveryFix: 1.5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-151",
    name: "\u0429\u0435\u043B\u043E\u0447\u043D\u044B\u0435/\u043A\u0438\u0441\u043B\u043E\u0442\u043D\u044B\u0435 \u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0430 \u0441\u0430\u043D\u0443\u0437\u043B\u043E\u0432",
    category: "\u0425\u0438\u043C\u0438\u044F \u0438 \u0443\u0431\u043E\u0440\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043B",
    price: 7,
    deliveryFix: 0.9,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-152",
    name: "\u041F\u043E\u0440\u043E\u0448\u043A\u0438/\u0433\u0435\u043B\u0438 \u043F\u0440\u0430\u0447\u0435\u0447\u043D\u043E\u0439",
    category: "\u0425\u0438\u043C\u0438\u044F \u0438 \u0443\u0431\u043E\u0440\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 5,
    deliveryFix: 0.7,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-153",
    name: "\u041C\u0438\u043A\u0440\u043E\u0444\u0438\u0431\u0440\u0430 (\u0446\u0432\u0435\u0442\u043E\u0432\u0430\u044F \u043A\u043E\u0434\u0438\u0440\u043E\u0432\u043A\u0430)",
    category: "\u0425\u0438\u043C\u0438\u044F \u0438 \u0443\u0431\u043E\u0440\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 1.5,
    deliveryFix: 0.2,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-154",
    name: "\u041F\u0435\u0440\u0447\u0430\u0442\u043A\u0438 \u043B\u0430\u0442\u0435\u043A\u0441\u043D\u044B\u0435/\u0440\u0435\u0437\u0438\u043D\u043E\u0432\u044B\u0435",
    category: "\u0425\u0438\u043C\u0438\u044F \u0438 \u0443\u0431\u043E\u0440\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0443\u043F",
    price: 4,
    deliveryFix: 0.5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-155",
    name: "\u041C\u0443\u0441\u043E\u0440\u043D\u044B\u0435 \u043C\u0435\u0448\u043A\u0438 30/60/120\u043B",
    category: "\u0425\u0438\u043C\u0438\u044F \u0438 \u0443\u0431\u043E\u0440\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0443\u043F",
    price: 6,
    deliveryFix: 0.8,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-156",
    name: "\u041F\u043E\u043B\u043E\u0442\u0435\u043D\u0446\u0430 \u0431\u0443\u043C\u0430\u0436\u043D\u044B\u0435 \u0441\u043B\u0443\u0436\u0435\u0431\u043D\u044B\u0435",
    category: "\u0425\u0438\u043C\u0438\u044F \u0438 \u0443\u0431\u043E\u0440\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0443\u043F",
    price: 3,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-157",
    name: "\u041D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u0430\u0442\u043E\u0440\u044B \u0437\u0430\u043F\u0430\u0445\u0430/\u0430\u0440\u043E\u043C\u0430\u0442\u0438\u0437\u0430\u0442\u043E\u0440\u044B",
    category: "\u0425\u0438\u043C\u0438\u044F \u0438 \u0443\u0431\u043E\u0440\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 5,
    deliveryFix: 0.7,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-158",
    name: "\u041A\u0430\u0441\u0441\u043E\u0432\u0430\u044F/\u0447\u0435\u043A\u043E\u0432\u0430\u044F \u043B\u0435\u043D\u0442\u0430, \u0442\u0435\u0440\u043C\u043E\u044D\u0442\u0438\u043A\u0435\u0442\u043A\u0438",
    category: "\u0425\u0438\u043C\u0438\u044F \u0438 \u0443\u0431\u043E\u0440\u043A\u0430",
    type: "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0443\u043F",
    price: 4,
    deliveryFix: 0.5,
    deliveryPct: 0,
    use: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-160",
    name: "\u0417\u0430\u043F\u0430\u0440\u043D\u0438\u043A \u0434\u043B\u044F \u0432\u0435\u043D\u0438\u043A\u043E\u0432 (\u043B\u0438\u043F\u0430/\u0434\u0443\u0431)",
    category: "\u0411\u043E\u043D\u0434\u0430\u0440\u043D\u044B\u0435 \u0438\u0437\u0434\u0435\u043B\u0438\u044F",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 60,
    deliveryFix: 8,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-161",
    name: "\u0428\u0430\u0439\u043A\u0438 \u0438 \u0442\u0430\u0437\u0438\u043A\u0438 \u0431\u0430\u043D\u043D\u044B\u0435",
    category: "\u0411\u043E\u043D\u0434\u0430\u0440\u043D\u044B\u0435 \u0438\u0437\u0434\u0435\u043B\u0438\u044F",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 25,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-162",
    name: "\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u043E\u0431\u043B\u0438\u0432\u0430\u043D\u0438\u044F \xAB\u0412\u043E\u0434\u043E\u043F\u0430\u0434\xBB",
    category: "\u0411\u043E\u043D\u0434\u0430\u0440\u043D\u044B\u0435 \u0438\u0437\u0434\u0435\u043B\u0438\u044F",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 350,
    deliveryFix: 40,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-163",
    name: "\u041A\u043E\u0432\u0448\u0438 \u0438 \u0447\u0435\u0440\u043F\u0430\u043A\u0438 \u0431\u0430\u043D\u043D\u044B\u0435",
    category: "\u0411\u043E\u043D\u0434\u0430\u0440\u043D\u044B\u0435 \u0438\u0437\u0434\u0435\u043B\u0438\u044F",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 15,
    deliveryFix: 2,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-164",
    name: "\u0427\u0430\u0448\u0438/\u043F\u0438\u0430\u043B\u044B \u0434\u0435\u0440\u0435\u0432\u044F\u043D\u043D\u044B\u0435 \u0433\u043E\u0441\u0442\u0435\u0432\u044B\u0435",
    category: "\u0411\u043E\u043D\u0434\u0430\u0440\u043D\u044B\u0435 \u0438\u0437\u0434\u0435\u043B\u0438\u044F",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 6,
    deliveryFix: 0.8,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-165",
    name: "\u0412\u0435\u0435\u0440\u0430/\u043E\u043F\u0430\u0445\u0430\u043B\u0430 \u043F\u0430\u0440\u043C\u0435\u0439\u0441\u0442\u0435\u0440\u0430 (\u043A\u043E\u043C\u043F\u043B)",
    category: "\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C \u043C\u0430\u0441\u0442\u0435\u0440\u043E\u0432",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 90,
    deliveryFix: 10,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-166",
    name: "\u0410\u0440\u043E\u043C\u0430-\u0447\u0430\u0448\u0438 \u0442\u0435\u0440\u043C\u043E\u0441\u0442\u043E\u0439\u043A\u0438\u0435",
    category: "\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C \u043C\u0430\u0441\u0442\u0435\u0440\u043E\u0432",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 25,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-167",
    name: "\u041F\u043E\u0434\u0433\u043E\u043B\u043E\u0432\u043D\u0438\u043A\u0438/\u0432\u0430\u043B\u0438\u043A\u0438 \u0430\u043D\u0430\u0442\u043E\u043C\u0438\u0447\u0435\u0441\u043A\u0438\u0435",
    category: "\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C \u043C\u0430\u0441\u0442\u0435\u0440\u043E\u0432",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 20,
    deliveryFix: 2.5,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-168",
    name: "\u041C\u0430\u0441\u0441\u0430\u0436\u043D\u044B\u0439 \u0441\u0442\u043E\u043B \u0441\u0442\u0430\u0446\u0438\u043E\u043D\u0430\u0440\u043D\u044B\u0439",
    category: "\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C \u043C\u0430\u0441\u0442\u0435\u0440\u043E\u0432",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 900,
    deliveryFix: 120,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-169",
    name: "\u0422\u0435\u043B\u0435\u0436\u043A\u0430 \u043C\u0430\u0441\u0442\u0435\u0440\u0430",
    category: "\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C \u043C\u0430\u0441\u0442\u0435\u0440\u043E\u0432",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 120,
    deliveryFix: 15,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-170",
    name: "\u0425\u0430\u043B\u0430\u0442 \u043C\u0430\u0445\u0440\u043E\u0432\u044B\u0439/\u0432\u0430\u0444\u0435\u043B\u044C\u043D\u044B\u0439",
    category: "\u0422\u0435\u043A\u0441\u0442\u0438\u043B\u044C HoReCa",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 25,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u043E\u0431\u043C\u0435\u043D\u043D\u044B\u0439 \u0444\u043E\u043D\u0434"
  },
  {
    code: "NC-171",
    name: "\u041F\u043E\u043B\u043E\u0442\u0435\u043D\u0446\u0435 \u0431\u0430\u043D\u043D\u043E\u0435 100x150",
    category: "\u0422\u0435\u043A\u0441\u0442\u0438\u043B\u044C HoReCa",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 9,
    deliveryFix: 1.2,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-172",
    name: "\u041A\u043E\u0432\u0440\u0438\u043A/\u043F\u043E\u043B\u043E\u0442\u0435\u043D\u0446\u0435 \u0434\u043B\u044F \u043D\u043E\u0433",
    category: "\u0422\u0435\u043A\u0441\u0442\u0438\u043B\u044C HoReCa",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 5,
    deliveryFix: 0.7,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-173",
    name: "\u041F\u0440\u043E\u0441\u0442\u044B\u043D\u044C \u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u043D\u0430\u044F/\u0433\u043E\u0441\u0442\u0435\u0432\u0430\u044F",
    category: "\u0422\u0435\u043A\u0441\u0442\u0438\u043B\u044C HoReCa",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 7,
    deliveryFix: 1,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-174",
    name: "\u0428\u0430\u043F\u043A\u0430 \u0431\u0430\u043D\u043D\u0430\u044F \u0432\u043E\u0439\u043B\u043E\u0447\u043D\u0430\u044F",
    category: "\u0422\u0435\u043A\u0441\u0442\u0438\u043B\u044C HoReCa",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 6,
    deliveryFix: 0.8,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-175",
    name: "\u041F\u043B\u0435\u0434 \u0444\u043B\u0438\u0441\u043E\u0432\u044B\u0439/\u0448\u0435\u0440\u0441\u0442\u044F\u043D\u043E\u0439",
    category: "\u0422\u0435\u043A\u0441\u0442\u0438\u043B\u044C HoReCa",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 18,
    deliveryFix: 2.5,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-176",
    name: "\u0423\u043D\u0438\u0444\u043E\u0440\u043C\u0430 \u043F\u0430\u0440\u043C\u0435\u0439\u0441\u0442\u0435\u0440\u0430/\u043C\u0430\u0441\u0441\u0430\u0436\u0438\u0441\u0442\u0430",
    category: "\u0423\u043D\u0438\u0444\u043E\u0440\u043C\u0430",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 70,
    deliveryFix: 8,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-177",
    name: "\u0423\u043D\u0438\u0444\u043E\u0440\u043C\u0430 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430",
    category: "\u0423\u043D\u0438\u0444\u043E\u0440\u043C\u0430",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u043E\u043C\u043F\u043B",
    price: 80,
    deliveryFix: 9,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-178",
    name: "\u041E\u0431\u0443\u0432\u044C \u0434\u043B\u044F \u0432\u043B\u0430\u0436\u043D\u044B\u0445 \u0437\u043E\u043D",
    category: "\u0423\u043D\u0438\u0444\u043E\u0440\u043C\u0430",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 35,
    deliveryFix: 4,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-179",
    name: "\u041A\u0430\u043C\u043D\u0438 \u0434\u043B\u044F \u043F\u0435\u0447\u0435\u0439 (\u0436\u0430\u0434\u0435\u0438\u0442/\u0442\u0430\u043B\u044C\u043A\u043E\u0445\u043B\u043E\u0440\u0438\u0434)",
    category: "\u0418\u043D\u0436\u0435\u043D\u0435\u0440\u0438\u044F",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u043A\u0433",
    price: 4,
    deliveryFix: 0.6,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: "\u0441\u043C\u0435\u043D\u043D\u044B\u0439 \u0444\u043E\u043D\u0434, \u043F\u0435\u0440\u0435\u043A\u043B\u0430\u0434\u043A\u0430 \u0440\u0430\u0437 \u0432 \u0433\u043E\u0434"
  },
  {
    code: "NC-180",
    name: "\u0424\u0438\u043B\u044C\u0442\u0440\u044B \u0432\u0435\u043D\u0442\u0438\u043B\u044F\u0446\u0438\u0438",
    category: "\u0418\u043D\u0436\u0435\u043D\u0435\u0440\u0438\u044F",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 25,
    deliveryFix: 3,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-181",
    name: "\u041A\u0430\u0440\u0442\u0440\u0438\u0434\u0436\u0438 \u0432\u043E\u0434\u043E\u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0438 / \u0423\u0424-\u043B\u0430\u043C\u043F\u044B",
    category: "\u0418\u043D\u0436\u0435\u043D\u0435\u0440\u0438\u044F",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 40,
    deliveryFix: 5,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-182",
    name: "\u0422\u0435\u0440\u043C\u043E\u043C\u0435\u0442\u0440/\u0433\u0438\u0433\u0440\u043E\u043C\u0435\u0442\u0440 \u0446\u0438\u0444\u0440\u043E\u0432\u043E\u0439",
    category: "\u0418\u043D\u0436\u0435\u043D\u0435\u0440\u0438\u044F",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 30,
    deliveryFix: 4,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-183",
    name: "\u0410\u043F\u0442\u0435\u0447\u043A\u0430 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0441\u0430",
    category: "\u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 80,
    deliveryFix: 10,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-184",
    name: "\u0421\u0435\u0440\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u044B \u043F\u043E\u0434\u0430\u0440\u043E\u0447\u043D\u044B\u0435 (\u043A\u043E\u043D\u0432\u0435\u0440\u0442\u044B)",
    category: "Retail",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 1.5,
    deliveryFix: 0.2,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-185",
    name: "\u0422\u0443\u0431\u0443\u0441\u044B/\u0441\u0435\u0442\u043A\u0438 \u0434\u043B\u044F \u0432\u0435\u043D\u0438\u043A\u043E\u0432 (\u0441\u0443\u0432\u0435\u043D\u0438\u0440)",
    category: "Retail",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 3,
    deliveryFix: 0.4,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  },
  {
    code: "NC-186",
    name: "\u0427\u0430\u0439 \u0444\u0438\u0440\u043C\u0435\u043D\u043D\u044B\u0439 \u0432 \u0431\u0430\u043D\u043A\u0430\u0445 (retail)",
    category: "Retail",
    type: "\u041D\u0435-\u0440\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A",
    unit: "\u0448\u0442",
    price: 8,
    deliveryFix: 1,
    deliveryPct: 0,
    use: "CAPEX",
    opexArticle: null,
    norm: 0,
    normBase: null,
    qty: 0,
    note: ""
  }
];

// src/model/scenario.ts
function resolveScenario(params2, matrix2, name) {
  const i = matrix2.names.indexOf(name);
  if (i < 0) throw new Error(`Unknown scenario: ${name}`);
  const pick = (v) => v[i];
  const steam = {
    y1: pick(matrix2.steam.y1),
    y3: pick(matrix2.steam.y3)
  };
  const massage = {
    y1: pick(matrix2.massage.y1),
    y3: pick(matrix2.massage.y3)
  };
  const glamping = {
    y1: pick(matrix2.glamping.y1),
    y3: pick(matrix2.glamping.y3)
  };
  const members = {
    y1: pick(matrix2.membersMonth.y1),
    y3: pick(matrix2.membersMonth.y3)
  };
  const steamLoad = [
    steam.y1,
    steam.y1 + (steam.y3 - steam.y1) * (20 / 35),
    steam.y3,
    Math.min(1, steam.y3 + 0.05),
    Math.min(1, steam.y3 + 0.05)
  ];
  const massageLoad = [
    massage.y1,
    massage.y1 + (massage.y3 - massage.y1) * (20 / 35),
    massage.y3,
    massage.y3 + 0.05,
    massage.y3 + 0.1
  ];
  const glampLoad = [
    glamping.y1,
    glamping.y1 + (glamping.y3 - glamping.y1) * (15 / 25),
    glamping.y3,
    glamping.y3 + 0.05,
    glamping.y3 + 0.1
  ];
  const membersMonth = [
    members.y1,
    Math.round(members.y1 + (members.y3 - members.y1) * (30 / 70)),
    members.y3,
    Math.round(members.y3 * 1.25),
    Math.round(members.y3 * (170 / 120))
  ];
  const isPackage = params2.meta.mode === "\u0414\u0430";
  const uptake = pick(matrix2.uptake);
  const activeMods = params2.modules.filter((m) => m.status === "\u0410\u043A\u0442\u0438\u0432\u0435\u043D");
  const avgCapacity = activeMods.reduce((s, m) => s + m.capacity, 0) / Math.max(1, activeMods.length);
  const presaleMonthly = params2.units.certsPerMonth * params2.prices.certificate + membersMonth[0] * params2.prices.membershipMonth + params2.units.annualMembersPlan[0] * params2.prices.membershipYear / 12;
  return {
    name,
    bathsLoad: matrix2.baths ? [
      pick(matrix2.baths.y1),
      pick(matrix2.baths.y2),
      pick(matrix2.baths.y3),
      pick(matrix2.baths.y4),
      pick(matrix2.baths.y5)
    ] : [],
    steamLoad,
    massageLoad,
    extraLoad: steamLoad.map((v) => v - 0.25),
    glampLoad,
    membersMonth,
    priceGrowth: pick(matrix2.priceGrowth),
    capexAdj: pick(matrix2.capexAdj),
    rampMonths: pick(matrix2.rampMonths),
    uptake,
    effectiveUptake: isPackage ? 1 : uptake,
    presaleMonthly,
    activeModules: activeMods.length,
    avgCapacity
  };
}

// src/model/revenue.ts
function addMonths(isoDate, months) {
  const [y, m] = isoDate.slice(0, 7).split("-").map(Number);
  const t = y * 12 + (m - 1) + months;
  return { year: Math.floor(t / 12), month: t % 12 + 1 };
}
function moduleActive(params2, launch, at) {
  const [ly, lm] = launch.slice(0, 7).split("-").map(Number);
  return at.year * 12 + at.month >= ly * 12 + lm;
}
function computeRevenueMonth(params2, sc, k) {
  const at = addMonths(params2.meta.openingDate, k);
  const yearIdx = Math.min(4, Math.floor(k / 12));
  const ramp = Math.min(1, (k + 1) / sc.rampMonths);
  const growth = Math.pow(1 + sc.priceGrowth, Math.floor(k / 12));
  const dm = params2.service.demandMult;
  const seas = params2.seasonality.baths[at.month - 1];
  const seasG = params2.seasonality.glamping[at.month - 1];
  const bathsLoad = Math.min(1, dm * sc.bathsLoad[yearIdx] * seas * ramp);
  const glampLoad = Math.min(1, dm * sc.glampLoad[yearIdx] * seasG * ramp);
  let slots = 0;
  let guests = 0;
  let rental = 0;
  let capSlots = 0;
  const slotCounts = params2.slotMix.map(() => 0);
  for (const m of params2.modules) {
    if (m.status !== "\u0410\u043A\u0442\u0438\u0432\u0435\u043D" || !moduleActive(params2, m.launchDate, at)) continue;
    capSlots += 30 * m.slotsPerDay * m.uptime * m.loadK;
    const s = 30 * m.slotsPerDay * m.uptime * m.loadK * bathsLoad;
    slots += s;
    guests += s * m.capacity;
    const avgPrice = m.prices.reduce((acc, p, j) => acc + p * params2.slotMix[j], 0);
    rental += s * avgPrice * growth;
    params2.slotMix.forEach((mix, j) => {
      slotCounts[j] += s * mix;
    });
  }
  const membersMonthCount = dm * sc.membersMonth[yearIdx] * ramp;
  const annualActive = dm * params2.units.annualMembersPlan[yearIdx] * ramp;
  const memberGuests = params2.members.consumeSlots ? (membersMonthCount + annualActive) * params2.members.visitsPerMonth * params2.members.partySize : 0;
  const memberSlots = memberGuests / sc.avgCapacity;
  if (memberSlots > 0 && capSlots > 0) {
    const paidSlots = Math.max(0, Math.min(slots, capSlots - memberSlots));
    const scale = slots > 0 ? paidSlots / slots : 1;
    slots = paidSlots;
    guests = guests * scale + memberGuests;
    rental *= scale;
    for (let j = 0; j < slotCounts.length; j++) slotCounts[j] *= scale;
  }
  const cap = sc.avgCapacity;
  const up = sc.effectiveUptake;
  const ld = params2.service.serviceLoads;
  const upSteam = up * (ld ? Math.min(1, sc.steamLoad[yearIdx]) : 1);
  const upMassage = up * (ld ? Math.min(1, sc.massageLoad[yearIdx]) : 1);
  const upExtra = up * (ld ? Math.min(1, sc.extraLoad[yearIdx]) : 1);
  const svc = slots;
  const swp = (set) => set.prices.reduce((acc, p, j) => acc + p * set.weights[j], 0);
  const steam = params2.procedures.steam.prices.map((p, j) => {
    const w = params2.procedures.steam.weights[j];
    return svc * cap * upSteam * ((1 - params2.service.walletExtraShare) * params2.deposit.steamBase * w * p / swp(params2.procedures.steam) + params2.service.upgradeShare * w * (p - params2.deposit.steamBase)) * growth;
  });
  const massage = params2.procedures.massage.prices.map((p, j) => {
    const w = params2.procedures.massage.weights[j];
    return svc * cap * upMassage * ((1 - params2.service.walletExtraShare) * params2.deposit.massageBase * w * p / swp(params2.procedures.massage) + params2.service.upgradeShare * w * (p - params2.deposit.massageBase)) * growth;
  });
  const extra = params2.procedures.extra.prices.map((p, j) => {
    const w = params2.procedures.extra.weights[j];
    return svc * cap * upExtra * params2.service.walletExtraShare * params2.deposit.base * (w * p) / swp(params2.procedures.extra) * growth;
  });
  const steamTotal = steam.reduce((a, b) => a + b, 0);
  const massageTotal = massage.reduce((a, b) => a + b, 0);
  const extraTotal = extra.reduce((a, b) => a + b, 0);
  const glamping = 30 * (params2.units.glampSmall * glampLoad * params2.prices.glampSmall + params2.units.glampBig * glampLoad * params2.prices.glampBig) * growth;
  const membersMonth = membersMonthCount * params2.prices.membershipMonth * growth;
  const membersYearCount = dm * params2.units.annualMembersPlan[yearIdx] / 12 * ramp;
  const membersYear = membersYearCount * params2.prices.membershipYear * growth;
  const certsCount = params2.units.certsPerMonth * dm * ramp;
  const certificates = certsCount * params2.prices.certificate * growth;
  const membershipTotal = membersMonth + membersYear + certificates;
  const fb = guests * params2.prices.fbPerGuest * growth;
  const total = rental + steamTotal + massageTotal + extraTotal + glamping + membershipTotal + fb;
  return {
    yearIdx,
    monthOfYear: at.month,
    ramp,
    bathsLoad,
    slots,
    guests,
    slotCounts,
    rental,
    steam,
    steamTotal,
    massage,
    massageTotal,
    extra,
    extraTotal,
    glamping,
    membersMonthCount,
    membersMonth,
    membersYear,
    memberSlots,
    memberGuests,
    certificates,
    membershipTotal,
    fb,
    total
  };
}
function computeRevenue(params2, sc) {
  const out2 = [];
  for (let k = 0; k < params2.meta.opsMonths; k++)
    out2.push(computeRevenueMonth(params2, sc, k));
  return out2;
}

// src/model/opex.ts
function landedCost(item) {
  return item.price + Math.max(item.deliveryFix, item.price * item.deliveryPct);
}
function fixedOpexMonthly(params2) {
  return params2.opexFixed.reduce(
    (s, f) => s + f.base * (f.perModule ? activeModuleCount(params2) : 1),
    0
  ) + (params2.it.enabled ? params2.it.opex.reduce((s, x) => s + x.base, 0) : 0);
}
function computeOpexMonth(params2, items2, rev, k) {
  const infl = Math.pow(1 + params2.general.inflation, Math.floor(k / 12));
  const fixed = params2.opexFixed.map(
    (f) => f.base * (f.perModule ? activeModuleCount(params2) : 1) * infl
  );
  const fixedTotal = fixed.reduce((a, b) => a + b, 0);
  const it = params2.it.enabled ? params2.it.opex.map((x) => ({ name: x.name, amount: x.base * infl })) : [];
  const itTotal = it.reduce((s, x) => s + x.amount, 0);
  const articles = [
    "\u041F\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043B\u044C\u0441\u043A\u0438\u0435",
    "\u0412\u0435\u043D\u0438\u043A\u0438",
    "\u0414\u0440\u043E\u0432\u0430 \u043E\u0441\u043D\u043E\u0432\u043D\u044B\u0435",
    "\u0414\u0440\u043E\u0432\u0430 \u0434\u043B\u044F \u043E\u0447\u0430\u0433\u0430",
    "\u0411\u0440\u0438\u043A\u0435\u0442\u044B \u0440\u0443\u0444",
    "\u0421\u0440\u0435\u0434\u0441\u0442\u0432\u0430 \u0433\u0438\u0433\u0438\u0435\u043D\u044B",
    "\u041A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430 / SPA",
    "\u041A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430 / \u043C\u0430\u0441\u0441\u0430\u0436",
    "\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C / \u0443\u0431\u043E\u0440\u043A\u0430",
    "\u041F\u0440\u0430\u0447\u0435\u0447\u043D\u0430\u044F / \u0442\u0435\u043A\u0441\u0442\u0438\u043B\u044C"
  ];
  const opexItems = items2.filter((it2) => it2.use === "OPEX");
  const variable = articles.map((article) => {
    const rel = opexItems.filter((it2) => it2.opexArticle === article);
    const byBase = (base) => rel.filter((it2) => it2.normBase === base).reduce((s, it2) => s + it2.norm * landedCost(it2), 0);
    const amount = (rev.slots * byBase("\u0441\u043B\u043E\u0442") + rev.guests * byBase("\u0433\u043E\u0441\u0442\u044C") + byBase("\u043C\u0435\u0441")) * infl;
    return { article, amount };
  });
  const variableTotal = variable.reduce((s, v) => s + v.amount, 0);
  const acquiring = params2.opexPct.acquiring * rev.total;
  const maintenance = params2.opexPct.maintenance * rev.total;
  const fbCost = params2.fb.enabled ? params2.fb.foodCostPct * rev.fb : 0;
  const ota = params2.glampOta.enabled ? rev.glamping * params2.glampOta.share * params2.glampOta.commissionPct : 0;
  const landRent = params2.land.mode === "lease" ? params2.land.rentMonthly * infl : 0;
  return {
    fixed,
    fixedTotal,
    it,
    itTotal,
    landRent,
    variable,
    variableTotal,
    pct: { acquiring, maintenance, fbCost, ota },
    pctTotal: acquiring + maintenance + fbCost + ota,
    total: fixedTotal + itTotal + landRent + variableTotal + acquiring + maintenance + fbCost + ota
  };
}
function computeOpex(params2, items2, revenue) {
  return revenue.map((r, k) => computeOpexMonth(params2, items2, r, k));
}
function activeModuleCount(params2) {
  return params2.modules.filter((m) => m.status === "\u0410\u043A\u0442\u0438\u0432\u0435\u043D").length;
}
function nomenclatureCapexEur(items2) {
  return items2.filter((it) => it.use === "CAPEX").reduce((s, it) => s + landedCost(it) * it.qty, 0);
}

// src/model/fot.ts
function baseSalariesMonthly(params2) {
  return params2.fot.count.reduce((s, c, i) => s + c * params2.fot.salary[i], 0) + (params2.it.enabled ? params2.it.curator : 0) + (params2.fb.enabled ? params2.fb.cookCount * params2.fb.cookSalary : 0);
}
function computeFotMonth(params2, rev, k) {
  const infl = Math.pow(1 + params2.general.inflation, Math.floor(k / 12));
  const salaries = baseSalariesMonthly(params2) * infl;
  const bonuses = rev.steamTotal * params2.kpi.steamShare + rev.massageTotal * params2.kpi.massageShare + rev.total * params2.kpi.revenueShare;
  const gross = salaries + bonuses;
  const employerContrib = gross * params2.taxes.employerRate;
  return { salaries, bonuses, gross, employerContrib, total: gross + employerContrib };
}
function computeFot(params2, revenue) {
  return revenue.map((r, k) => computeFotMonth(params2, r, k));
}

// src/model/capex.ts
function computeCapex(params2, items2, capexAdj) {
  const rate = params2.general.rubEurRate;
  const out2 = params2.capexItems.map((it) => {
    let eur;
    if (it.row === 30) {
      eur = nomenclatureCapexEur(items2);
    } else {
      const qty = it.qty === "MODULES_COUNT" ? activeModuleCount(params2) : Number(it.qty ?? 0);
      eur = qty * Number(it.priceRub ?? 0) / rate;
    }
    return { name: it.name ?? "", eur };
  });
  if (params2.it.enabled) out2.push(...params2.it.capex.map((c) => ({ name: c.name, eur: c.eur })));
  const landEur = params2.land.mode === "purchase" ? params2.land.purchaseCost : 0;
  if (landEur) out2.push({ name: "\u0417\u0435\u043C\u043B\u044F / \u0443\u0447\u0430\u0441\u0442\u043E\u043A", eur: landEur });
  const totalEur = out2.reduce((s, i) => s + i.eur, 0);
  const adjustedEur = totalEur * (1 + capexAdj);
  const amortizableEur = adjustedEur - landEur * (1 + capexAdj);
  const monthlyAmort = params2.amort.shares.reduce(
    (s, sh, i) => s + amortizableEur * sh / (params2.amort.years[i] * 12),
    0
  );
  const monthlyTaxDepr = params2.taxDepr.enabled ? params2.amort.shares.reduce(
    (s, sh, i) => s + amortizableEur * sh / (params2.taxDepr.years[i] * 12),
    0
  ) : monthlyAmort;
  const unitEur = params2.capexItems.filter((it) => it.qty === "MODULES_COUNT").reduce((s, it) => s + Number(it.priceRub ?? 0) / rate, 0);
  const ym = (iso) => {
    const [y, m] = iso.slice(0, 7).split("-").map(Number);
    return y * 12 + m;
  };
  const openYm = ym(params2.meta.openingDate);
  const deferred = params2.modules.filter((m) => m.status === "\u0410\u043A\u0442\u0438\u0432\u0435\u043D" && ym(m.launchDate) > openYm).map((m) => ({
    month: ym(m.launchDate) - ym(params2.meta.constructionStart) + 1,
    // 1-based месяц CF
    eur: unitEur * (1 + capexAdj)
  }));
  return { items: out2, totalEur, adjustedEur, monthlyAmort, amortizableEur, monthlyTaxDepr, deferred };
}

// src/model/taxes.ts
function computeVat(params2, revenue, opex, capexAdjustedEur) {
  const r = params2.taxes;
  const reimb = params2.meta.vatMode === "\u0421 \u0432\u043E\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u0435\u043C";
  const out2 = [];
  let credit = 0;
  for (let k = 0; k < revenue.length; k++) {
    const rev = revenue[k];
    const vatOut19 = (rev.rental + rev.steamTotal + rev.massageTotal + rev.extraTotal + rev.membershipTotal) * r.vatStd / (1 + r.vatStd);
    const vatOut9 = rev.glamping * r.vatGlamp / (1 + r.vatGlamp) + rev.fb * r.vatFb / (1 + r.vatFb);
    const inputVat = reimb ? (opex[k].fixedTotal + opex[k].variableTotal + opex[k].itTotal) * r.vatInput / (1 + r.vatInput) + (k === 0 ? capexAdjustedEur * r.vatInput / (1 + r.vatInput) : 0) : 0;
    const vatOut = vatOut19 + vatOut9;
    const vatPayable = Math.max(0, vatOut - inputVat - credit);
    credit = Math.max(0, credit + inputVat - vatOut);
    out2.push({ vatOut19, vatOut9, inputVat, vatCredit: credit, vatPayable });
  }
  return out2;
}
function computeProfitTaxes(params2, revenue, ebit, netProfitPreDiv, vat) {
  const r = params2.taxes;
  const years = Math.ceil(params2.meta.opsMonths / 12);
  const citByYear = [];
  let lossCarry = 0;
  for (let y = 0; y < years; y++) {
    const ebitY = ebit.slice(y * 12, y * 12 + 12).reduce((a, b) => a + b, 0);
    const used = Math.min(Math.max(0, ebitY), lossCarry);
    const taxable = Math.max(0, ebitY - used);
    citByYear.push(taxable * r.cit);
    lossCarry = lossCarry - used + Math.max(0, -ebitY);
  }
  const distShare = params2.partners.shares.reduce((a, b) => a + b, 0) + params2.partners.corporate.mgmt;
  const sdcWeighted = params2.partners.shares.reduce(
    (s, sh, i) => s + sh * (params2.partners.statuses[i] === "\u0420\u0435\u0437\u0438\u0434\u0435\u043D\u0442 \u041A\u0438\u043F\u0440\u0430 (17%)" ? r.sdc : 0),
    0
  );
  const gesyWeighted = params2.partners.shares.reduce(
    (s, sh, i) => s + sh * (params2.partners.statuses[i] === "\u0420\u0435\u0437\u0438\u0434\u0435\u043D\u0442 \u041A\u0438\u043F\u0440\u0430 (17%)" ? r.gesy : 0),
    0
  );
  const taxes = vat.map((v, k) => {
    const y = Math.min(years - 1, Math.floor(k / 12));
    const mo = revenue[k].monthOfYear;
    const cit = mo === 6 || mo === 12 ? citByYear[y] / 2 : 0;
    const dividends = k >= 12 ? Math.max(0, netProfitPreDiv[k - 12]) * distShare : 0;
    const sdc = dividends * sdcWeighted / distShare;
    const gesy = dividends * gesyWeighted / distShare;
    return { ...v, cit, dividends, sdc, gesy, total: v.vatPayable + cit + sdc + gesy };
  });
  return { taxes, citByYear };
}

// src/model/pnl.ts
function computePnl(params2, revenue, opex, fot, taxes, monthlyAmort) {
  return revenue.map((rev, k) => {
    const revenueNet = rev.total - taxes[k].vatPayable;
    const marginalProfit = revenueNet - opex[k].variableTotal - opex[k].pctTotal;
    const ebitda = marginalProfit - opex[k].fixedTotal - opex[k].itTotal - opex[k].landRent - fot[k].total;
    const ebit = ebitda - monthlyAmort;
    const netProfit = ebit - taxes[k].cit;
    return {
      revenueNet,
      revenueGross: rev.total,
      variableOpex: opex[k].variableTotal,
      pctOpex: opex[k].pctTotal,
      marginalProfit,
      fixedOpex: opex[k].fixedTotal + opex[k].itTotal + opex[k].landRent,
      fot: fot[k].total,
      ebitda,
      amortization: monthlyAmort,
      ebit,
      cit: taxes[k].cit,
      netProfit,
      dividends: taxes[k].dividends,
      sdc: taxes[k].sdc,
      gesy: taxes[k].gesy,
      netAfterSdc: netProfit - taxes[k].sdc - taxes[k].gesy
    };
  });
}

// src/model/cashflow.ts
var MONTHS_RU = ["\u042F\u043D\u0432", "\u0424\u0435\u0432", "\u041C\u0430\u0440", "\u0410\u043F\u0440", "\u041C\u0430\u0439", "\u0418\u044E\u043D", "\u0418\u044E\u043B", "\u0410\u0432\u0433", "\u0421\u0435\u043D", "\u041E\u043A\u0442", "\u041D\u043E\u044F", "\u0414\u0435\u043A"];
function addMonthsIso(isoDate, months) {
  const [y, m] = isoDate.slice(0, 7).split("-").map(Number);
  const t = y * 12 + (m - 1) + months;
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, "0")}`;
}
function computeCashFlow(params2, pnl, capexAdjustedEur, presaleMonthly, deferredCapex = []) {
  const total = params2.meta.capexMonths + params2.meta.opsMonths;
  const deferredTotal = deferredCapex.reduce((s, d) => s + d.eur, 0);
  const capexPerMonth = -(capexAdjustedEur - deferredTotal) / params2.meta.capexMonths;
  const presaleEnd = params2.meta.capexMonths;
  const presaleStart = presaleEnd - params2.units.presaleMonths + 1;
  const deferred = params2.units.presaleMode === "deferred";
  const recogMonths = Math.max(1, params2.units.presaleRecognizeMonths);
  const unwindMonthly = deferred ? presaleMonthly * params2.units.presaleMonths / recogMonths : 0;
  const preopenMonths = params2.preopen.enabled ? Math.min(params2.preopen.months, params2.meta.capexMonths) : 0;
  const preopenStart = params2.meta.capexMonths - preopenMonths + 1;
  const preopenMonthly = -(baseSalariesMonthly(params2) * (1 + params2.taxes.employerRate) + fixedOpexMonthly(params2));
  let cumCash = 0;
  let cumFcff = 0;
  let cumDcf = 0;
  let pool = 0;
  const out2 = [];
  for (let i = 0; i < total; i++) {
    const m1 = i + 1;
    const isOps = m1 > params2.meta.capexMonths;
    const opsIdx = m1 - params2.meta.capexMonths - 1;
    const date = addMonthsIso(params2.meta.constructionStart, i);
    const label = `${MONTHS_RU[Number(date.slice(5)) - 1]} ${date.slice(0, 4)}`;
    const netProfit = isOps ? pnl[opsIdx].netProfit : 0;
    const amortization = isOps ? pnl[opsIdx].amortization : 0;
    const operatingCf = netProfit + amortization;
    const defCapex = deferredCapex.filter((d) => d.month === m1).reduce((s, d) => s - d.eur, 0);
    const capex = m1 <= params2.meta.capexMonths ? capexPerMonth : 0;
    const presale = m1 <= presaleEnd && m1 >= presaleStart ? presaleMonthly : 0;
    const presaleUnwind = isOps && opsIdx < recogMonths ? -unwindMonthly : 0;
    pool += presale + presaleUnwind;
    const landLease = !isOps && params2.land.mode === "lease" ? -params2.land.rentMonthly : 0;
    const preopen = !isOps && m1 >= preopenStart ? preopenMonthly : 0;
    const fcff = operatingCf + capex + defCapex + presale + presaleUnwind + landLease + preopen;
    const dividends = isOps ? -pnl[opsIdx].dividends : 0;
    const sdc = isOps ? -pnl[opsIdx].sdc : 0;
    const gesy = isOps ? -pnl[opsIdx].gesy : 0;
    const totalCf = fcff + dividends + sdc + gesy;
    cumCash += totalCf;
    cumFcff += fcff;
    const discountFactor = 1 / Math.pow(1 + params2.general.wacc / 12, m1);
    const discountedFcff = fcff * discountFactor;
    cumDcf += discountedFcff;
    out2.push({
      label,
      isOps,
      netProfit,
      amortization,
      operatingCf,
      capex,
      deferredCapex: defCapex,
      presale,
      presaleUnwind,
      prepaidPool: pool,
      landLease,
      preopen,
      fcff,
      dividends,
      sdc,
      gesy,
      totalCf,
      cumCash,
      cumFcff,
      discountFactor,
      discountedFcff,
      cumDcf
    });
  }
  return out2;
}

// src/model/kpis.ts
function irr(flows, guess = 0.02) {
  let lo = -0.99;
  let hi = 10;
  const npv = (r) => flows.reduce((s, f, i) => s + f / Math.pow(1 + r, i + 1), 0);
  while (npv(hi) > 0 && hi < 1e4) hi *= 2;
  if (npv(lo) * npv(hi) > 0) return NaN;
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
function computeKpis(params2, cashflow) {
  const fcff = cashflow.map((m) => m.fcff);
  const npv = cashflow[cashflow.length - 1].cumDcf;
  const irrMonthly = irr(fcff);
  const irrAnnual = Math.pow(1 + irrMonthly, 12) - 1;
  const paybackMonths = cashflow.findIndex((m) => m.cumFcff > 0) + 1 || 0;
  const discountedPaybackMonths = cashflow.findIndex((m) => m.cumDcf > 0) + 1 || 0;
  const peakFundingNeed = Math.min(...cashflow.map((m) => m.cumFcff));
  const investedTotal = fcff.filter((f) => f < 0).reduce((s, f) => s - f, 0);
  const returnedTotal = fcff.filter((f) => f > 0).reduce((s, f) => s + f, 0);
  const moic = investedTotal > 0 ? returnedTotal / investedTotal : NaN;
  const y3 = fcff.slice(params2.meta.capexMonths + 24, params2.meta.capexMonths + 36);
  const cashOnCash = investedTotal > 0 ? y3.reduce((s, f) => s + f, 0) / investedTotal : NaN;
  const g = params2.tv?.growth ?? 0;
  let tvValue = 0;
  if (params2.tv?.enabled && params2.general.wacc > g) {
    const lastYearFcff = fcff.slice(-12).reduce((s, f) => s + f, 0);
    const tvUndisc = lastYearFcff * (1 + g) / (params2.general.wacc - g);
    tvValue = tvUndisc * cashflow[cashflow.length - 1].discountFactor;
  }
  const npvWithTv = npv + tvValue;
  return { npv, irrMonthly, irrAnnual, paybackMonths, discountedPaybackMonths, peakFundingNeed, moic, cashOnCash, investedTotal, tvValue, npvWithTv };
}

// src/model/run.ts
function runModel(params2, matrix2, items2, scenario = params2.meta.scenario, overrides = {}) {
  const p = JSON.parse(JSON.stringify(params2));
  if (overrides.demandMult !== void 0) p.service.demandMult = overrides.demandMult;
  if (overrides.wacc !== void 0) p.general.wacc = overrides.wacc;
  if (overrides.priceMult !== void 0) applyPriceMult(p, overrides.priceMult);
  if (overrides.mode !== void 0) p.meta.mode = overrides.mode;
  if (overrides.vatMode !== void 0) p.meta.vatMode = overrides.vatMode;
  if (overrides.mutate) overrides.mutate(p);
  const sc = resolveScenario(p, matrix2, scenario);
  if (overrides.priceGrowth !== void 0) sc.priceGrowth = overrides.priceGrowth;
  if (overrides.capexAdj !== void 0) sc.capexAdj = overrides.capexAdj;
  if (overrides.loadMult !== void 0) {
    const L = overrides.loadMult;
    for (const key of ["bathsLoad", "steamLoad", "massageLoad", "extraLoad", "glampLoad"])
      sc[key] = sc[key].map((v) => v * L);
    sc.membersMonth = sc.membersMonth.map((v) => v * L);
  }
  const capex = computeCapex(p, items2, sc.capexAdj);
  const revenue = computeRevenue(p, sc);
  const opex = computeOpex(p, items2, revenue);
  const fot = computeFot(p, revenue);
  const vat = computeVat(p, revenue, opex, capex.adjustedEur);
  const ebit = revenue.map(
    (r, k) => r.total - vat[k].vatPayable - opex[k].variableTotal - opex[k].pctTotal - opex[k].fixedTotal - opex[k].itTotal - opex[k].landRent - fot[k].total - capex.monthlyAmort
  );
  const citEbit = ebit.map((e) => e + capex.monthlyAmort - capex.monthlyTaxDepr);
  const citPass = computeProfitTaxes(p, revenue, citEbit, citEbit.map(() => 0), vat);
  const netPreDiv = ebit.map((e, k) => e - citPass.taxes[k].cit);
  const { taxes, citByYear } = computeProfitTaxes(p, revenue, citEbit, netPreDiv, vat);
  const pnl = computePnl(p, revenue, opex, fot, taxes, capex.monthlyAmort);
  const cashflow = computeCashFlow(p, pnl, capex.adjustedEur, sc.presaleMonthly, capex.deferred);
  const kpis = computeKpis(p, cashflow);
  return {
    scenario: sc,
    revenue,
    opex,
    fot,
    taxes,
    pnl,
    cashflow,
    capex,
    citByYear,
    kpis
  };
}
function applyPriceMult(p, mult) {
  for (const m of p.modules) m.prices = m.prices.map((x) => x * mult);
  for (const set of [p.procedures.steam, p.procedures.massage, p.procedures.extra])
    set.prices = set.prices.map((x) => x * mult);
  p.prices.membershipMonth *= mult;
  p.prices.membershipYear *= mult;
  p.prices.certificate *= mult;
  p.prices.glampSmall *= mult;
  p.prices.glampBig *= mult;
  p.prices.fbPerGuest *= mult;
  p.deposit.base *= mult;
  p.deposit.steamBase *= mult;
  p.deposit.massageBase *= mult;
}

// src/model/sensitivity.ts
var T1_DEMAND = [0.8, 0.9, 1, 1.1, 1.2];
var T1_WACC = [0.1, 0.12, 0.14, 0.17, 0.2];
var T2_GROWTH = [0, 0.02, 0.03, 0.05, 0.07];
var T2_CAPEX = [0, 0.1, 0.15, 0.2, 0.3];
var T3_PRICE = [0.8, 0.9, 1, 1.1, 1.2];
function computeSensitivity(params2, matrix2, items2) {
  const t0 = performance.now();
  const scenario = params2.meta.scenario;
  const t1 = T1_DEMAND.map((demand) => ({
    demand,
    cells: T1_WACC.map((wacc) => {
      const r = runModel(params2, matrix2, items2, scenario, { demandMult: demand, wacc });
      return { wacc, npv: r.kpis.npv, discPayback: r.kpis.discountedPaybackMonths };
    })
  }));
  const t2 = T2_GROWTH.map((priceGrowth) => ({
    priceGrowth,
    cells: T2_CAPEX.map((capexAdj) => {
      const r = runModel(params2, matrix2, items2, scenario, { priceGrowth, capexAdj });
      return { capexAdj, npv: r.kpis.npv, irr: r.kpis.irrAnnual };
    })
  }));
  const t3 = T3_PRICE.map((priceMult) => {
    const r = runModel(params2, matrix2, items2, scenario, { priceMult });
    return { priceMult, npv: r.kpis.npv, irr: r.kpis.irrAnnual };
  });
  return {
    t1: { waccAxis: T1_WACC, rows: t1 },
    t2: { capexAxis: T2_CAPEX, rows: t2 },
    t3,
    computedInMs: performance.now() - t0
  };
}
function computeBreakEven(params2, matrix2, items2) {
  const scenario = params2.meta.scenario;
  const ebitdaY3 = (mult) => {
    const r = runModel(params2, matrix2, items2, scenario, { loadMult: mult });
    return r.pnl.slice(24, 36).reduce((s, p) => s + p.ebitda, 0) / 12;
  };
  const ebitdaBase = ebitdaY3(1);
  if (ebitdaBase <= 0 || ebitdaY3(0) >= 0) return { loadMult: NaN, ebitdaBase };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ebitdaY3(mid) > 0) hi = mid;
    else lo = mid;
  }
  return { loadMult: hi, ebitdaBase };
}
function computeTornado(params2, matrix2, items2, baseNpv) {
  const scenario = params2.meta.scenario;
  const baseCapexAdj = resolveScenario(params2, matrix2, scenario).capexAdj;
  const baseWacc = params2.general.wacc;
  const drivers = [
    { label: "\u0421\u043F\u0440\u043E\u0441", loLabel: "\u221215%", hiLabel: "+15%", lo: { demandMult: 0.85 }, hi: { demandMult: 1.15 } },
    { label: "\u0423\u0440\u043E\u0432\u0435\u043D\u044C \u0446\u0435\u043D", loLabel: "\u221210%", hiLabel: "+10%", lo: { priceMult: 0.9 }, hi: { priceMult: 1.1 } },
    { label: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0441\u043B\u043E\u0442\u043E\u0432", loLabel: "\u221215%", hiLabel: "+15%", lo: { loadMult: 0.85 }, hi: { loadMult: 1.15 } },
    { label: "CAPEX", loLabel: "+15%", hiLabel: "\u0431\u0435\u0437 \u0431\u0443\u0444\u0435\u0440\u0430", lo: { capexAdj: baseCapexAdj + 0.15 }, hi: { capexAdj: 0 } },
    { label: "WACC", loLabel: `+3\u043F.\u043F.`, hiLabel: "\u22123\u043F.\u043F.", lo: { wacc: baseWacc + 0.03 }, hi: { wacc: Math.max(0.01, baseWacc - 0.03) } },
    {
      label: "Uptime \u043C\u043E\u0434\u0443\u043B\u0435\u0439",
      loLabel: "\u22125\u043F.\u043F.",
      hiLabel: "+3\u043F.\u043F.",
      lo: { mutate: (p) => p.modules.forEach((m) => {
        m.uptime = Math.max(0.5, m.uptime - 0.05);
      }) },
      hi: { mutate: (p) => p.modules.forEach((m) => {
        m.uptime = Math.min(1, m.uptime + 0.03);
      }) }
    },
    {
      label: "\u041F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u044B\u0435 OPEX",
      loLabel: "+15%",
      hiLabel: "\u221215%",
      lo: { mutate: (p) => p.opexFixed.forEach((f) => {
        f.base *= 1.15;
      }) },
      hi: { mutate: (p) => p.opexFixed.forEach((f) => {
        f.base *= 0.85;
      }) }
    },
    {
      label: "\u041E\u043A\u043B\u0430\u0434\u044B \u0448\u0442\u0430\u0442\u0430",
      loLabel: "+15%",
      hiLabel: "\u221215%",
      lo: { mutate: (p) => {
        p.fot.salary = p.fot.salary.map((s) => s * 1.15);
      } },
      hi: { mutate: (p) => {
        p.fot.salary = p.fot.salary.map((s) => s * 0.85);
      } }
    },
    {
      label: "\u0421\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C F&B",
      loLabel: "+5\u043F.\u043F.",
      hiLabel: "\u22125\u043F.\u043F.",
      lo: { mutate: (p) => {
        p.fb.foodCostPct += 0.05;
      } },
      hi: { mutate: (p) => {
        p.fb.foodCostPct = Math.max(0, p.fb.foodCostPct - 0.05);
      } }
    },
    {
      label: "\u0414\u043E\u043B\u044F OTA (\u0433\u043B\u044D\u043C\u043F\u0438\u043D\u0433)",
      loLabel: "+15\u043F.\u043F.",
      hiLabel: "0% (\u043F\u0440\u044F\u043C\u044B\u0435)",
      lo: { mutate: (p) => {
        p.glampOta.share = Math.min(1, p.glampOta.share + 0.15);
      } },
      hi: { mutate: (p) => {
        p.glampOta.share = 0;
      } }
    },
    {
      label: "\u0418\u043D\u0444\u043B\u044F\u0446\u0438\u044F",
      loLabel: "+1\u043F.\u043F.",
      hiLabel: "\u22121\u043F.\u043F.",
      lo: { mutate: (p) => {
        p.general.inflation += 0.01;
      } },
      hi: { mutate: (p) => {
        p.general.inflation = Math.max(0, p.general.inflation - 0.01);
      } }
    }
  ];
  return drivers.map((d) => ({
    label: d.label,
    loLabel: d.loLabel,
    hiLabel: d.hiLabel,
    npvLo: runModel(params2, matrix2, items2, scenario, d.lo).kpis.npv,
    npvHi: runModel(params2, matrix2, items2, scenario, d.hi).kpis.npv
  })).sort(
    (a, b) => Math.max(Math.abs(b.npvHi - baseNpv), Math.abs(b.npvLo - baseNpv)) - Math.max(Math.abs(a.npvHi - baseNpv), Math.abs(a.npvLo - baseNpv))
  );
}

// scripts/snapshot.ts
var params = params_default;
var matrix = scenarios_default;
var items = nomenclature_default;
var capexM = params.meta.capexMonths;
var R = (v) => typeof v === "number" && isFinite(v) ? Math.round(v) : v;
var scenarios = {};
for (const name of matrix.names) {
  const r = runModel(params, matrix, items, name);
  const byYear = /* @__PURE__ */ new Map();
  r.cashflow.forEach((cf, i) => {
    const y = `20${cf.label.slice(-2)}`;
    const g = byYear.get(y) ?? { year: y, revenue: 0, opex: 0, fot: 0, ebitda: 0, cit: 0, netProfit: 0, fcff: 0, cumFcff: 0 };
    g.fcff = g.fcff + cf.fcff;
    g.cumFcff = cf.cumFcff;
    if (cf.isOps) {
      const p = r.pnl[i - capexM];
      const o = r.opex[i - capexM];
      const f = r.fot[i - capexM];
      if (p) {
        g.revenue = g.revenue + p.revenueGross;
        g.ebitda = g.ebitda + p.ebitda;
        g.cit = g.cit + p.cit;
        g.netProfit = g.netProfit + p.netProfit;
      }
      if (o) g.opex = g.opex + o.total;
      if (f) g.fot = g.fot + f.total;
    }
    byYear.set(y, g);
  });
  const streams = { rental: 0, steam: 0, massage: 0, extra: 0, glamping: 0, membership: 0, fb: 0 };
  for (const m of r.revenue) {
    streams.rental += m.rental;
    streams.steam += m.steamTotal;
    streams.massage += m.massageTotal;
    streams.extra += m.extraTotal;
    streams.glamping += m.glamping;
    streams.membership += m.membershipTotal;
    streams.fb += m.fb;
  }
  const monthly = r.cashflow.map((cf, i) => ({
    month: cf.label,
    revenue: cf.isOps ? R(r.revenue[i - capexM]?.total) : 0,
    ebitda: cf.isOps ? R(r.pnl[i - capexM]?.ebitda) : 0,
    fcff: R(cf.fcff),
    cumFcff: R(cf.cumFcff)
  }));
  scenarios[name] = {
    kpis: r.kpis,
    revenueStreamsTotal: Object.fromEntries(Object.entries(streams).map(([k, v]) => [k, R(v)])),
    yearly: [...byYear.values()].map((g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, R(v)]))),
    monthly
  };
}
var sens = computeSensitivity(params, matrix, items);
var tornado = computeTornado(params, matrix, items, runModel(params, matrix, items, params.meta.scenario).kpis.npv);
var breakEven = computeBreakEven(params, matrix, items);
var snapshot = {
  generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
  note: "\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u043D\u043D\u044B\u0439 \u0441\u043D\u0438\u043C\u043E\u043A \u043C\u043E\u0434\u0435\u043B\u0438 AURA HILLS: KPI, \u0433\u043E\u0434\u043E\u0432\u044B\u0435 P&L/FCFF, \u043F\u043E\u043C\u0435\u0441\u044F\u0447\u043D\u044B\u0435 \u0442\u0430\u0431\u043B\u0438\u0446\u044B, \u0447\u0443\u0432\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C. \u0412\u0430\u043B\u044E\u0442\u0430 EUR.",
  currency: "EUR",
  horizonMonths: capexM + params.meta.opsMonths,
  constructionMonths: capexM,
  wacc: params.general.wacc,
  scenarios,
  sensitivity: { ...sens, tornado, breakEven }
};
var out = resolve(process.cwd(), "public/data/model-snapshot.json");
writeFileSync(out, JSON.stringify(snapshot));
console.log(`snapshot \u2192 ${out}`);
