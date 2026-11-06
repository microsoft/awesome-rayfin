const fs = require('node:fs');
const path = require('node:path');

const SEED = 'LTG291-CALDOVA-291';
const SALES_DAYS = 70;
const START_DATE = '2026-04-06';
const OUTPUT_DIR = path.join(__dirname, 'generated');

const HEADERS = {
  stores: ['store_id', 'name', 'city', 'region', 'manager_upn'],
  products: ['sku', 'name', 'category', 'unit_price', 'pack_size'],
  inventory: ['store_id', 'sku', 'on_hand_qty', 'reorder_point', 'safety_stock'],
  sales: ['date', 'store_id', 'sku', 'units_sold', 'revenue'],
  restock_requests: [
    'request_id',
    'store_id',
    'sku',
    'qty',
    'requested_by',
    'requested_by_id',
    'requested_at',
    'status',
    'note',
  ],
};

const RESTOCK_SEED_REQUESTS = [
  { store_id: 'STO-NW-002', sku: 'COLD-003', qty: 120, day_offset: 62, hour: 8, minute: 12, status: 'fulfilled', note: 'Weekly top-up ahead of the holiday weekend' },
  { store_id: 'STO-MW-002', sku: 'VIT-001', qty: 90, day_offset: 63, hour: 9, minute: 41, status: 'fulfilled', note: 'Shelf gap flagged during the morning count' },
  { store_id: 'STO-SE-002', sku: 'DIGEST-003', qty: 60, day_offset: 64, hour: 14, minute: 5, status: 'fulfilled', note: 'Promotion pulled forward two weeks of demand' },
  { store_id: 'STO-SW-002', sku: 'ALLERGY-003', qty: 150, day_offset: 66, hour: 7, minute: 58, status: 'submitted', note: 'Pollen season running hot across the region' },
  { store_id: 'STO-NE-002', sku: 'PAIN-005', qty: 75, day_offset: 67, hour: 11, minute: 23, status: 'submitted', note: 'Covering a delayed delivery from the primary supplier' },
  { store_id: 'STO-NW-003', sku: 'FIRST-001', qty: 40, day_offset: 68, hour: 16, minute: 30, status: 'submitted', note: 'Restocking after the school sports season rush' },
  { store_id: 'STO-MW-003', sku: 'COLD-005', qty: 110, day_offset: 69, hour: 10, minute: 7, status: 'submitted', note: 'Late cold snap driving lozenge sales' },
  { store_id: 'STO-SE-003', sku: 'VIT-005', qty: 85, day_offset: 69, hour: 15, minute: 44, status: 'submitted', note: 'Immunity range under-stocked since last cycle count' },
];

const CATEGORY_BASE_DEMAND = {
  'Pain relief': 2.8,
  'Cold & flu': 2.5,
  Vitamins: 2.0,
  Allergy: 1.8,
  Digestive: 1.5,
  'First aid': 1.0,
};

const STORE_CATALOG = [
  { store_id: 'STO-NW-001', name: 'Emerald Pharmacy', city: 'Seattle', region: 'Northwest', manager_upn: 'maya.brooks@caldova.demo', store_factor: 1.18 },
  { store_id: 'STO-NW-002', name: 'Riverfront Pharmacy', city: 'Portland', region: 'Northwest', manager_upn: 'owen.rivera@caldova.demo', store_factor: 0.97 },
  { store_id: 'STO-NW-003', name: 'Summit Pharmacy', city: 'Boise', region: 'Northwest', manager_upn: 'hazel.hughes@caldova.demo', store_factor: 0.82 },
  { store_id: 'STO-SW-001', name: 'Desert Bloom Pharmacy', city: 'Phoenix', region: 'Southwest', manager_upn: 'lucas.ward@caldova.demo', store_factor: 1.08 },
  { store_id: 'STO-SW-002', name: 'Mission Valley Pharmacy', city: 'San Diego', region: 'Southwest', manager_upn: 'sofia.reed@caldova.demo', store_factor: 1.05 },
  { store_id: 'STO-SW-003', name: 'Lone Star Pharmacy', city: 'Austin', region: 'Southwest', manager_upn: 'elijah.bailey@caldova.demo', store_factor: 1.12 },
  { store_id: 'STO-MW-001', name: 'Lakeside Pharmacy', city: 'Chicago', region: 'Midwest', manager_upn: 'ava.murphy@caldova.demo', store_factor: 1.22 },
  { store_id: 'STO-MW-002', name: 'Mill District Pharmacy', city: 'Minneapolis', region: 'Midwest', manager_upn: 'noah.sanders@caldova.demo', store_factor: 0.88 },
  { store_id: 'STO-MW-003', name: 'Union Station Pharmacy', city: 'Kansas City', region: 'Midwest', manager_upn: 'ella.price@caldova.demo', store_factor: 0.9 },
  { store_id: 'STO-SE-001', name: 'Peachtree Pharmacy', city: 'Atlanta', region: 'Southeast', manager_upn: 'liam.cook@caldova.demo', store_factor: 1.15 },
  { store_id: 'STO-SE-002', name: 'Gulfbay Pharmacy', city: 'Tampa', region: 'Southeast', manager_upn: 'zoe.morgan@caldova.demo', store_factor: 0.94 },
  { store_id: 'STO-SE-003', name: 'Biscayne Pharmacy', city: 'Miami', region: 'Southeast', manager_upn: 'ethan.foster@caldova.demo', store_factor: 1.1 },
  { store_id: 'STO-NE-001', name: 'Harborline Pharmacy', city: 'Boston', region: 'Northeast', manager_upn: 'ivy.howard@caldova.demo', store_factor: 1.07 },
  { store_id: 'STO-NE-002', name: 'Liberty Square Pharmacy', city: 'Philadelphia', region: 'Northeast', manager_upn: 'mason.bennett@caldova.demo', store_factor: 1.14 },
  { store_id: 'STO-NE-003', name: 'Hudson Market Pharmacy', city: 'Newark', region: 'Northeast', manager_upn: 'chloe.bryant@caldova.demo', store_factor: 0.86 },
];

const PRODUCT_GROUPS = [
  {
    category: 'Pain relief',
    skuPrefix: 'PAIN',
    items: [
      { name: 'RapidRelief Ibuprofen 200 mg', unit_price: '8.49', pack_size: '24 ct' },
      { name: 'RapidRelief Ibuprofen 200 mg', unit_price: '13.99', pack_size: '50 ct' },
      { name: 'CaldoPain Acetaminophen 500 mg', unit_price: '7.99', pack_size: '24 ct' },
      { name: 'CaldoPain Acetaminophen 500 mg', unit_price: '12.49', pack_size: '50 ct' },
      { name: 'JointEase Naproxen Sodium', unit_price: '10.99', pack_size: '40 ct' },
      { name: 'HeadClear Migraine Relief Caplets', unit_price: '11.49', pack_size: '20 ct' },
      { name: 'FlexiMuscle Pain Relief Gel', unit_price: '9.79', pack_size: '100 ml' },
      { name: 'WarmPatch Heat Therapy', unit_price: '6.99', pack_size: '6 ct' },
      { name: 'RapidRelief Child Pain Suspension', unit_price: '7.49', pack_size: '120 ml' },
      { name: 'MuscleReset Epsom Soak', unit_price: '5.99', pack_size: '1 kg' },
    ],
  },
  {
    category: 'Cold & flu',
    skuPrefix: 'COLD',
    items: [
      { name: 'ClearBreathe Daytime Cold and Flu', unit_price: '9.49', pack_size: '24 ct' },
      { name: 'ClearBreathe Nighttime Cold and Flu', unit_price: '9.99', pack_size: '24 ct' },
      { name: 'ClearBreathe Cough Syrup', unit_price: '8.79', pack_size: '180 ml' },
      { name: 'SinusReset Decongestant', unit_price: '10.49', pack_size: '18 ct' },
      { name: 'ThroatCalm Lozenges Honey Lemon', unit_price: '4.99', pack_size: '20 ct' },
      { name: 'VapourEase Chest Rub', unit_price: '6.49', pack_size: '100 g' },
      { name: 'ThermoCare Digital Thermometer', unit_price: '12.99', pack_size: '1 ct' },
      { name: 'Kids Cough and Fever Relief', unit_price: '8.99', pack_size: '120 ml' },
      { name: 'ZincBoost Cold Defense', unit_price: '7.99', pack_size: '30 ct' },
      { name: 'SalineMist Nasal Spray', unit_price: '5.49', pack_size: '90 ml' },
    ],
  },
  {
    category: 'Vitamins',
    skuPrefix: 'VIT',
    items: [
      { name: 'DailyCore Multivitamin Adults', unit_price: '12.99', pack_size: '60 ct' },
      { name: 'DailyCore Multivitamin Women', unit_price: '13.49', pack_size: '60 ct' },
      { name: 'DailyCore Multivitamin Men', unit_price: '13.49', pack_size: '60 ct' },
      { name: 'SunnyD3 Vitamin D Gummies', unit_price: '11.99', pack_size: '90 ct' },
      { name: 'ImmunoC Vitamin C 1000 mg', unit_price: '9.99', pack_size: '100 ct' },
      { name: 'Magnesium Restore Tablets', unit_price: '10.49', pack_size: '80 ct' },
      { name: 'Kids Multivitamin Gummies', unit_price: '10.99', pack_size: '60 ct' },
      { name: 'Iron Balance Capsules', unit_price: '9.49', pack_size: '45 ct' },
      { name: 'OmegaPlus Fish Oil', unit_price: '14.99', pack_size: '90 ct' },
      { name: 'B12 Energy Melt Tabs', unit_price: '8.99', pack_size: '60 ct' },
    ],
  },
  {
    category: 'Allergy',
    skuPrefix: 'ALLERGY',
    items: [
      { name: 'AllerEase 24h Tablets', unit_price: '14.49', pack_size: '30 ct' },
      { name: 'AllerEase Fast Melt', unit_price: '13.99', pack_size: '24 ct' },
      { name: 'SinusShield Nasal Spray', unit_price: '12.49', pack_size: '120 sprays' },
      { name: 'EyeCalm Allergy Drops', unit_price: '9.79', pack_size: '15 ml' },
      { name: 'Kids AllerEase Syrup', unit_price: '10.49', pack_size: '120 ml' },
      { name: 'AirPure Non Drowsy Caps', unit_price: '11.99', pack_size: '20 ct' },
      { name: 'AllerEase Extra Strength', unit_price: '15.49', pack_size: '30 ct' },
      { name: 'Saline Rinse Kit', unit_price: '16.99', pack_size: '1 ct' },
      { name: 'ItchCalm Anti Itch Cream', unit_price: '7.99', pack_size: '45 g' },
      { name: 'HiveGuard Antihistamine', unit_price: '10.99', pack_size: '24 ct' },
    ],
  },
  {
    category: 'Digestive',
    skuPrefix: 'DIGEST',
    items: [
      { name: 'DigestWell Antacid Chews', unit_price: '6.49', pack_size: '72 ct' },
      { name: 'DigestWell Acid Relief', unit_price: '8.99', pack_size: '28 ct' },
      { name: 'ProBio Balance Capsules', unit_price: '15.99', pack_size: '30 ct' },
      { name: 'GentleFiber Gummies', unit_price: '11.49', pack_size: '60 ct' },
      { name: 'StomachSettle Ginger Chews', unit_price: '5.99', pack_size: '40 ct' },
      { name: 'DigestWell Laxative Tablets', unit_price: '7.49', pack_size: '24 ct' },
      { name: 'HydratePlus Electrolyte Mix', unit_price: '9.99', pack_size: '10 ct' },
      { name: 'GasRelief Softgels', unit_price: '8.49', pack_size: '30 ct' },
      { name: 'Kids Tummy Relief', unit_price: '7.99', pack_size: '120 ml' },
      { name: 'NauseaCalm Motion Bands', unit_price: '10.99', pack_size: '2 ct' },
    ],
  },
  {
    category: 'First aid',
    skuPrefix: 'FIRST',
    items: [
      { name: 'CleanSeal Bandages Assorted', unit_price: '5.49', pack_size: '80 ct' },
      { name: 'FlexGuard Waterproof Bandages', unit_price: '5.99', pack_size: '60 ct' },
      { name: 'QuickHeal Gauze Pads', unit_price: '4.99', pack_size: '25 ct' },
      { name: 'SkinSafe Antiseptic Spray', unit_price: '6.99', pack_size: '150 ml' },
      { name: 'BurnCool Gel', unit_price: '7.49', pack_size: '50 g' },
      { name: 'FirstResponse Antibiotic Ointment', unit_price: '6.79', pack_size: '30 g' },
      { name: 'FlexWrap Elastic Bandage', unit_price: '4.49', pack_size: '1 ct' },
      { name: 'BlisterShield Cushions', unit_price: '5.29', pack_size: '12 ct' },
      { name: 'SteriClean Wipes', unit_price: '4.79', pack_size: '40 ct' },
      { name: 'RescueTape Medical Tape', unit_price: '3.99', pack_size: '1 ct' },
    ],
  },
];

const HERO_LOW_STOCK_ASSIGNMENTS = [
  { store_id: 'STO-NW-001', sku: 'PAIN-001' },
  { store_id: 'STO-SW-001', sku: 'ALLERGY-001' },
  { store_id: 'STO-MW-001', sku: 'COLD-002' },
  { store_id: 'STO-SE-001', sku: 'PAIN-003' },
  { store_id: 'STO-SE-003', sku: 'VIT-004' },
  { store_id: 'STO-NE-001', sku: 'DIGEST-001' },
];

const HERO_LOW_STOCK_KEYS = new Set(
  HERO_LOW_STOCK_ASSIGNMENTS.map(({ store_id, sku }) => `${store_id}|${sku}`),
);

function hash32(value) {
  let hash = 2166136261;
  const input = `${SEED}|${value}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashFraction(value) {
  return hash32(value) / 4294967295;
}

function keyedRange(key, min, max) {
  return min + hashFraction(key) * (max - min);
}

function formatMoney(value) {
  return value.toFixed(2);
}

function escapeCsvValue(value) {
  const stringValue = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(stringValue) || /^\s|\s$/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function serializeCsvRows(rows, headers) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvValue(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function formatDate(dayOffset) {
  const start = new Date(`${START_DATE}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + dayOffset);
  return start.toISOString().slice(0, 10);
}

function formatTimestamp(dayOffset, hour, minute) {
  const start = new Date(`${START_DATE}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + dayOffset);
  start.setUTCHours(hour, minute, 0, 0);
  return `${start.toISOString().slice(0, 19)}Z`;
}

function deterministicGuid(key) {
  let hex = '';
  for (let index = 0; index < 4; index += 1) {
    hex += hash32(`guid|${index}|${key}`).toString(16).padStart(8, '0');
  }
  const variant = '89ab'[parseInt(hex[16], 16) % 4];
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

function weekdayMultiplier(dateString) {
  const day = new Date(`${dateString}T00:00:00Z`).getUTCDay();
  return [0.86, 1.08, 1.1, 1.03, 1.0, 1.04, 0.92][day];
}

function categorySeasonality(category, dayIndex) {
  const progress = dayIndex / (SALES_DAYS - 1);
  switch (category) {
    case 'Cold & flu':
      return 1.18 - progress * 0.22;
    case 'Allergy':
      return 0.97 + Math.sin((progress + 0.08) * Math.PI) * 0.18;
    case 'Vitamins':
      return 1.02 + Math.cos(progress * Math.PI * 2) * 0.03;
    case 'Pain relief':
      return 1.0 + Math.sin(progress * Math.PI * 1.5) * 0.05;
    case 'Digestive':
      return 0.98 + Math.sin((progress + 0.2) * Math.PI * 2) * 0.04;
    case 'First aid':
      return 0.95 + Math.cos(progress * Math.PI * 1.2) * 0.03;
    default:
      return 1;
  }
}

function regionalDemandBias(region, category) {
  const biases = {
    Northwest: { 'Cold & flu': 1.07, Allergy: 0.97 },
    Southwest: { Allergy: 1.12, Vitamins: 1.04 },
    Midwest: { 'Pain relief': 1.05, 'Cold & flu': 1.08 },
    Southeast: { Vitamins: 1.07, Digestive: 1.05 },
    Northeast: { Digestive: 1.08, 'Cold & flu': 1.04 },
  };
  return (biases[region] && biases[region][category]) || 1;
}

function buildProducts() {
  return PRODUCT_GROUPS.flatMap((group) =>
    group.items.map((item, index) => ({
      sku: `${group.skuPrefix}-${String(index + 1).padStart(3, '0')}`,
      name: item.name,
      category: group.category,
      unit_price: item.unit_price,
      pack_size: item.pack_size,
      popularity: Number((1.28 - index * 0.05).toFixed(3)),
    })),
  );
}

function buildSales(stores, products) {
  const sales = [];
  const totalsByPair = new Map();

  for (let dayIndex = 0; dayIndex < SALES_DAYS; dayIndex += 1) {
    const date = formatDate(dayIndex);
    for (const store of stores) {
      for (const product of products) {
        const pairKey = `${store.store_id}|${product.sku}`;
        const weekKey = `${Math.floor(dayIndex / 7)}|${pairKey}`;
        let demand = CATEGORY_BASE_DEMAND[product.category] * store.store_factor * product.popularity;
        demand *= regionalDemandBias(store.region, product.category);
        demand *= keyedRange(`affinity|${pairKey}`, 0.88, 1.16);
        demand *= weekdayMultiplier(date);
        demand *= categorySeasonality(product.category, dayIndex);
        demand *= keyedRange(`weekly-pulse|${weekKey}`, 0.95, 1.08);

        if (HERO_LOW_STOCK_KEYS.has(pairKey)) {
          demand *= 1.72;
        }

        const unitsSold = Math.max(
          0,
          Math.round(demand * keyedRange(`daily-noise|${date}|${pairKey}`, 0.8, 1.24)),
        );

        totalsByPair.set(pairKey, (totalsByPair.get(pairKey) || 0) + unitsSold);
        sales.push({
          date,
          store_id: store.store_id,
          sku: product.sku,
          units_sold: unitsSold,
          revenue: formatMoney(unitsSold * Number(product.unit_price)),
        });
      }
    }
  }

  return { sales, totalsByPair };
}

function buildInventory(stores, products, totalsByPair) {
  const inventory = [];

  for (const store of stores) {
    for (const product of products) {
      const pairKey = `${store.store_id}|${product.sku}`;
      const avgDailySales = Math.max((totalsByPair.get(pairKey) || 0) / SALES_DAYS, 0.25);
      const stockPressure = hashFraction(`stock-pressure|${pairKey}`);

      let safetyStock = Math.max(
        4,
        Math.round(avgDailySales * keyedRange(`safety-days|${pairKey}`, 4.5, 7.4)),
      );
      let reorderPoint = Math.max(
        safetyStock + 2,
        Math.round(avgDailySales * keyedRange(`reorder-days|${pairKey}`, 7.2, 10.4)),
      );
      let coverageDays =
        stockPressure < 0.14
          ? keyedRange(`tight-coverage|${pairKey}`, 3.5, 7.5)
          : keyedRange(`healthy-coverage|${pairKey}`, 11.5, 23.5);
      let onHandQty = Math.max(2, Math.round(avgDailySales * coverageDays));

      if (stockPressure < 0.14 && onHandQty >= reorderPoint) {
        onHandQty = Math.max(
          2,
          reorderPoint - Math.max(1, Math.round(avgDailySales * keyedRange(`tight-gap|${pairKey}`, 1.2, 3.4))),
        );
      }

      if (HERO_LOW_STOCK_KEYS.has(pairKey)) {
        safetyStock = Math.max(
          10,
          Math.round(avgDailySales * keyedRange(`hero-safety|${pairKey}`, 4.4, 5.6)),
        );
        reorderPoint = Math.max(
          safetyStock + 4,
          Math.round(avgDailySales * keyedRange(`hero-reorder|${pairKey}`, 6.8, 8.6)),
        );
        coverageDays = keyedRange(`hero-coverage|${pairKey}`, 0.78, 1.42);
        onHandQty = Math.max(3, Math.round(avgDailySales * coverageDays));
      }

      inventory.push({
        store_id: store.store_id,
        sku: product.sku,
        on_hand_qty: onHandQty,
        reorder_point: reorderPoint,
        safety_stock: safetyStock,
      });
    }
  }

  return inventory;
}

function buildRestockRequests(stores) {
  const managerByStore = new Map(stores.map((store) => [store.store_id, store.manager_upn]));

  return RESTOCK_SEED_REQUESTS.map((seed) => {
    const requestedBy = managerByStore.get(seed.store_id);
    const requestedAt = formatTimestamp(seed.day_offset, seed.hour, seed.minute);

    return {
      request_id: deterministicGuid(`request|${seed.store_id}|${seed.sku}|${requestedAt}`),
      store_id: seed.store_id,
      sku: seed.sku,
      qty: seed.qty,
      requested_by: requestedBy,
      requested_by_id: deterministicGuid(`identity|${requestedBy}`),
      requested_at: requestedAt,
      status: seed.status,
      note: seed.note,
    };
  });
}

function buildDataset() {
  const products = buildProducts();
  const { sales, totalsByPair } = buildSales(STORE_CATALOG, products);
  const inventory = buildInventory(STORE_CATALOG, products, totalsByPair);
  const stores = STORE_CATALOG.map(({ store_factor, ...store }) => store);

  return {
    stores,
    products: products.map(({ popularity, ...product }) => product),
    inventory,
    sales,
    restock_requests: buildRestockRequests(stores),
  };
}

function datasetToFiles(dataset) {
  return {
    'stores.csv': serializeCsvRows(dataset.stores, HEADERS.stores),
    'products.csv': serializeCsvRows(dataset.products, HEADERS.products),
    'inventory.csv': serializeCsvRows(dataset.inventory, HEADERS.inventory),
    'sales.csv': serializeCsvRows(dataset.sales, HEADERS.sales),
    'restock_requests.csv': serializeCsvRows(dataset.restock_requests, HEADERS.restock_requests),
  };
}

function writeDataset(outputDir = OUTPUT_DIR) {
  const dataset = buildDataset();
  const files = datasetToFiles(dataset);
  fs.mkdirSync(outputDir, { recursive: true });

  for (const [fileName, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(outputDir, fileName), content, 'utf8');
  }

  return { dataset, files };
}

function describeHeroAssignments(dataset) {
  const salesTotals = new Map();
  for (const row of dataset.sales) {
    const key = `${row.store_id}|${row.sku}`;
    salesTotals.set(key, (salesTotals.get(key) || 0) + row.units_sold);
  }

  const inventoryByKey = new Map(
    dataset.inventory.map((row) => [`${row.store_id}|${row.sku}`, row]),
  );
  const productBySku = new Map(dataset.products.map((row) => [row.sku, row]));
  const storeById = new Map(dataset.stores.map((row) => [row.store_id, row]));

  return HERO_LOW_STOCK_ASSIGNMENTS.map(({ store_id, sku }) => {
    const key = `${store_id}|${sku}`;
    const inventoryRow = inventoryByKey.get(key);
    const product = productBySku.get(sku);
    const store = storeById.get(store_id);
    const avgDailySales = (salesTotals.get(key) || 0) / SALES_DAYS;
    return `${store.city} / ${product.name} (${inventoryRow.on_hand_qty} on hand, ${avgDailySales.toFixed(1)} avg/day)`;
  });
}

if (require.main === module) {
  const { dataset } = writeDataset();
  console.log(`Generated Caldova dataset in ${OUTPUT_DIR}`);
  console.log(
    `Stores: ${dataset.stores.length} | Products: ${dataset.products.length} | Inventory: ${dataset.inventory.length} | Sales: ${dataset.sales.length} | Restock requests: ${dataset.restock_requests.length}`,
  );
  console.log(`Hero low-stock SKUs: ${describeHeroAssignments(dataset).join(' ; ')}`);
}

module.exports = {
  HEADERS,
  HERO_LOW_STOCK_ASSIGNMENTS,
  OUTPUT_DIR,
  RESTOCK_SEED_REQUESTS,
  SALES_DAYS,
  SEED,
  START_DATE,
  buildDataset,
  datasetToFiles,
  escapeCsvValue,
  serializeCsvRows,
  writeDataset,
};
