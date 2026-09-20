/**
 * マルチ口座 資産運用シミュレーター PRO (Wealth Simulator Pro)
 * Core Logic & Simulation Engine
 */

// ============================================================================
// State Management
// ============================================================================
const DEFAULT_STATE = {
  currentAge: 35,
  endAge: 60, // 基本プロファイルに集約された積立終了年齢
  accounts: {
    taxable: {
      initial: 100, // 万円 (億円まで入力可能)
      rate: 5.0,    // %/年
      patterns: [
        { years: 10, monthly: 2.0 },
        { years: 10, monthly: 0.0 },
        { years: 5,  monthly: 0.0 }
      ]
    },
    oldNisa: {
      baseYear: 2024,    // シミュレーション基準西暦年 (現在)
      rate: 5.0,         // %/年
      years: {
        2018: 40,        // 2018年買付分 (2038年特定移管)
        2019: 40,        // 2019年買付分 (2039年特定移管)
        2020: 40,        // 2020年買付分 (2040年特定移管)
        2021: 40,        // 2021年買付分 (2041年特定移管)
        2022: 40,        // 2022年買付分 (2042年特定移管)
        2023: 40         // 2023年買付分 (2043年特定移管)
      }
    },
    newNisa: {
      initial: 300,      // 万円
      rate: 5.0,         // %/年
      patterns: [
        { years: 10, monthly: 5.0 },
        { years: 10, monthly: 0.0 },
        { years: 5,  monthly: 0.0 }
      ]
    },
    dc: {
      initial: 150,      // 万円
      monthly: 2.3,      // 万円/月
      rate: 4.5,         // %/年
      receiveAge: 60,    // 歳で退職金受取
      yearsPast: 5       // これまでの拠出年数
    },
    stock: {
      initial: 200,      // 万円
      monthly: 0.0,      // 万円/月
      rate: 4.0          // %/年 (原則取崩し対象外)
    }
  },
  pension: {
    startAge: 65,        // 歳から受給開始
    monthly: 15.0        // 万円/月
  },
  withdraw: {
    startAge: 65,        // 歳から取崩し開始
    type: 'fixed-amount', // 'fixed-amount' | 'fixed-rate'
    monthly: 30.0,       // 万円/月 (定額取崩し時)
    rate: 4.0            // %/年 (定率取崩し時)
  },
  chartType: 'stacked',  // 'stacked' | 'cashflow' | 'lines'
  theme: 'dark',
  detailTableOpen: false
};

// Application State Object (Cloned from Default)
let state = JSON.parse(JSON.stringify(DEFAULT_STATE));

// ============================================================================
// Financial Calculations (現行退職所得控除 & シミュレーション)
// ============================================================================
const NISA_LIFETIME_LIMIT = 1800; // 万円
const CAPITAL_GAINS_TAX = 0.20315; // 20.315% (特定口座運用益・譲渡益税)

/**
 * 3パターンの順次実質計算対象期間を算出
 * @param {number} currentAge - 現在の年齢
 * @param {number} endAge - 積立終了年齢
 * @param {Array} patterns - [{ years: number, monthly: number }, ...]
 * @returns {Array} - [{ reqYears, effYears, startAge, endAge, monthly, isCapped, isZero }, ...]
 */
function calcEffectivePatterns(currentAge, endAge, patterns) {
  const result = [];
  let cursorAge = currentAge;

  (patterns || []).forEach((p, idx) => {
    const reqYears = Math.max(0, parseInt(p.years, 10) || 0);
    const monthly = Math.max(0, parseFloat(p.monthly) || 0);
    const availYears = Math.max(0, endAge - cursorAge);
    const effYears = Math.min(reqYears, availYears);
    const startAge = cursorAge;
    const patternEndAge = cursorAge + effYears;

    result.push({
      index: idx,
      reqYears,
      effYears,
      startAge,
      endAge: patternEndAge,
      monthly,
      isCapped: reqYears > effYears && effYears > 0,
      isZero: effYears === 0
    });

    cursorAge += effYears;
  });

  return result;
}

/**
 * 現行の退職所得控除 & 退職所得課税計算
 * @param {number} grossAmount - DC受取総額 (万円)
 * @param {number} totalYears - 勤続・拠出年数 (年)
 */
function calcRetirementTax(grossAmount, totalYears) {
  const years = Math.max(1, Math.ceil(totalYears));
  let deduction = 0; // 万円

  // 1. 退職所得控除額
  if (years <= 20) {
    deduction = Math.max(80, 40 * years);
  } else {
    deduction = 800 + 70 * (years - 20);
  }

  // 2. 課税退職所得金額 (1,000円未満切り捨て、0以下は0)
  const taxableIncomeYen = Math.max(0, Math.floor(((grossAmount - deduction) * 10000 * 0.5) / 1000) * 1000);
  const taxableIncomeMan = taxableIncomeYen / 10000;

  if (taxableIncomeYen <= 0) {
    return {
      grossAmount,
      years,
      deduction,
      taxableIncome: 0,
      totalTax: 0,
      netAmount: grossAmount
    };
  }

  // 3. 所得税の速算表 (円単位)
  let baseIncomeTaxYen = 0;
  if (taxableIncomeYen <= 1950000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.05;
  } else if (taxableIncomeYen <= 3300000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.10 - 97500;
  } else if (taxableIncomeYen <= 6950000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.20 - 427500;
  } else if (taxableIncomeYen <= 9000000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.23 - 636000;
  } else if (taxableIncomeYen <= 18000000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.33 - 1536000;
  } else if (taxableIncomeYen <= 40000000) {
    baseIncomeTaxYen = taxableIncomeYen * 0.40 - 2796000;
  } else {
    baseIncomeTaxYen = taxableIncomeYen * 0.45 - 4796000;
  }

  // 復興特別所得税 (2.1%)
  const reconTaxYen = baseIncomeTaxYen * 0.021;
  const incomeTaxYen = Math.floor(baseIncomeTaxYen + reconTaxYen);

  // 住民税 (一律10%)
  const residentTaxYen = Math.floor(taxableIncomeYen * 0.10);

  const totalTaxYen = incomeTaxYen + residentTaxYen;
  const totalTaxMan = Math.round((totalTaxYen / 10000) * 100) / 100;
  const netAmountMan = Math.round((grossAmount - totalTaxMan) * 100) / 100;

  return {
    grossAmount,
    years,
    deduction,
    taxableIncome: taxableIncomeMan,
    incomeTax: incomeTaxYen / 10000,
    residentTax: residentTaxYen / 10000,
    totalTax: totalTaxMan,
    netAmount: netAmountMan
  };
}

/**
 * ライフサイクル資産シミュレーションエンジン (順次計算対応)
 * @param {object} cfg - 現在のstate設定
 */
function runSimulation(cfg) {
  const currentAge = parseInt(cfg.currentAge, 10) || 0;
  const globalEndAge = parseInt(cfg.endAge, 10) || 0;
  const endAge = 100;
  const totalYears = Math.max(0, endAge - currentAge);

  // 実効積立パターンを算出
  const taxableEff = calcEffectivePatterns(currentAge, globalEndAge, cfg.accounts.taxable.patterns);
  const newNisaEff = calcEffectivePatterns(currentAge, globalEndAge, cfg.accounts.newNisa.patterns);

  // 各口座の現在残高
  let balTaxable = parseFloat(cfg.accounts.taxable.initial) || 0;
  let bookTaxable = balTaxable; // 簿価 (元本)

  // 旧NISA (2018〜2023年の各年度スロット管理)
  const oldNisaYears = [2018, 2019, 2020, 2021, 2022, 2023];
  const oldNisaBaseYear = parseInt(cfg.accounts.oldNisa.baseYear, 10) || 2024;
  const oldNisaSlots = {};
  let balOldNisa = 0;

  oldNisaYears.forEach(yr => {
    const val = (cfg.accounts.oldNisa.years && cfg.accounts.oldNisa.years[yr] !== undefined)
      ? (parseFloat(cfg.accounts.oldNisa.years[yr]) || 0)
      : 0;
    oldNisaSlots[yr] = val;
    balOldNisa += val;
  });

  let balNewNisa = parseFloat(cfg.accounts.newNisa.initial) || 0;
  let bookNewNisa = Math.min(balNewNisa, NISA_LIFETIME_LIMIT); // 生涯枠カウント用簿価

  let balDc = parseFloat(cfg.accounts.dc.initial) || 0;
  let dcReceived = false;
  let dcNetTransferred = 0;
  let dcTaxPaid = 0;

  let balStock = parseFloat(cfg.accounts.stock.initial) || 0;

  // DCの通算年数計算
  const dcYearsPast = parseFloat(cfg.accounts.dc.yearsPast) || 0;

  const records = [];

  // 初期状態 (0年目 / 現在の年齢)
  records.push({
    age: currentAge,
    year: 0,
    calYear: oldNisaBaseYear,
    totalAssets: Math.round((balTaxable + balOldNisa + balNewNisa + balDc + balStock) * 10) / 10,
    taxable: Math.round(balTaxable * 10) / 10,
    oldNisa: Math.round(balOldNisa * 10) / 10,
    newNisa: Math.round(balNewNisa * 10) / 10,
    dc: Math.round(balDc * 10) / 10,
    stock: Math.round(balStock * 10) / 10,
    annualContribute: 0,
    annualGain: 0,
    annualPension: 0,
    dcTransfer: 0,
    oldNisaTransfer: 0,
    annualWithdraw: 0,
    status: 'initial'
  });

  for (let y = 1; y <= totalYears; y++) {
    const age = currentAge + y;
    const calYear = oldNisaBaseYear + y;
    let yearContributeTotal = 0;
    let yearGainTotal = 0;
    let dcTransferThisYear = 0;
    let oldNisaTransferThisYear = 0;

    // -------------------------------------------------------------
    // 1. 各口座の積立・運用複利計算
    // -------------------------------------------------------------

    // ① 特定口座 (順次パターンの判定)
    let taxableMonthly = 0;
    const activeTaxable = taxableEff.find(eff => eff.startAge < age && age <= eff.endAge);
    if (activeTaxable) {
      taxableMonthly = activeTaxable.monthly;
    }
    const taxableAnnualContribute = taxableMonthly * 12;
    const taxableRate = (parseFloat(cfg.accounts.taxable.rate) || 0) / 100;
    const taxableGain = (balTaxable + taxableAnnualContribute * 0.5) * taxableRate;
    balTaxable += taxableAnnualContribute + taxableGain;
    bookTaxable += taxableAnnualContribute;
    yearContributeTotal += taxableAnnualContribute;
    yearGainTotal += taxableGain;

    // ② 旧NISA口座 (各年度スロット運用 & 21年目順次特定口座移管)
    let oldNisaGain = 0;
    const oldNisaRate = (parseFloat(cfg.accounts.oldNisa.rate) || 0) / 100;

    oldNisaYears.forEach(yr => {
      if (oldNisaSlots[yr] > 0) {
        // 運用利回り計算
        const gain = oldNisaSlots[yr] * oldNisaRate;
        oldNisaSlots[yr] += gain;
        oldNisaGain += gain;

        // 21年目に特定口座へ順次移管 (保有期限20年: 投資年 + 20年満了時)
        const transferYear = yr + 20; // 例: 2018年分 → 2038年
        if (calYear >= transferYear) {
          const transferAmt = oldNisaSlots[yr];
          balTaxable += transferAmt;
          bookTaxable += transferAmt; // 移管時時価が新たな特定口座の簿価となる
          oldNisaTransferThisYear += transferAmt;
          oldNisaSlots[yr] = 0;
        }
      }
    });
    balOldNisa = oldNisaYears.reduce((sum, yr) => sum + oldNisaSlots[yr], 0);
    yearGainTotal += oldNisaGain;

    // ③ 新NISA口座 (順次パターンの判定 & 生涯上限1,800万)
    let newNisaMonthly = 0;
    const activeNewNisa = newNisaEff.find(eff => eff.startAge < age && age <= eff.endAge);
    if (activeNewNisa) {
      newNisaMonthly = activeNewNisa.monthly;
    }
    let newNisaAnnualContribute = newNisaMonthly * 12;
    if (bookNewNisa + newNisaAnnualContribute > NISA_LIFETIME_LIMIT) {
      newNisaAnnualContribute = Math.max(0, NISA_LIFETIME_LIMIT - bookNewNisa);
    }
    bookNewNisa += newNisaAnnualContribute;
    const newNisaRate = (parseFloat(cfg.accounts.newNisa.rate) || 0) / 100;
    const newNisaGain = (balNewNisa + newNisaAnnualContribute * 0.5) * newNisaRate;
    balNewNisa += newNisaAnnualContribute + newNisaGain;
    yearContributeTotal += newNisaAnnualContribute;
    yearGainTotal += newNisaGain;

    // ④ 確定拠出年金 (DC/iDeCo)
    let dcMonthly = 0;
    if (!dcReceived) {
      if (age <= globalEndAge) {
        dcMonthly = parseFloat(cfg.accounts.dc.monthly) || 0;
      }
      const dcAnnualContribute = dcMonthly * 12;
      const dcRate = (parseFloat(cfg.accounts.dc.rate) || 0) / 100;
      const dcGain = (balDc + dcAnnualContribute * 0.5) * dcRate;
      balDc += dcAnnualContribute + dcGain;
      yearContributeTotal += dcAnnualContribute;
      yearGainTotal += dcGain;

      // 退職金受取年齢に到達した場合
      if (age >= cfg.accounts.dc.receiveAge && cfg.accounts.dc.receiveAge > 0) {
        const totalDcYears = dcYearsPast + (age - currentAge);
        const taxResult = calcRetirementTax(balDc, totalDcYears);
        dcNetTransferred = taxResult.netAmount;
        dcTaxPaid = taxResult.totalTax;
        dcTransferThisYear = dcNetTransferred;

        // 手取り額を特定口座へ移管
        balTaxable += dcNetTransferred;
        bookTaxable += dcNetTransferred;
        balDc = 0;
        dcReceived = true;
      }
    }

    // ⑤ 株式現物口座
    let stockMonthly = 0;
    if (age <= globalEndAge) {
      stockMonthly = parseFloat(cfg.accounts.stock.monthly) || 0;
    }
    const stockAnnualContribute = stockMonthly * 12;
    const stockRate = (parseFloat(cfg.accounts.stock.rate) || 0) / 100;
    const stockGain = (balStock + stockAnnualContribute * 0.5) * stockRate;
    balStock += stockAnnualContribute + stockGain;
    yearContributeTotal += stockAnnualContribute;
    yearGainTotal += stockGain;

    // -------------------------------------------------------------
    // 2. 年金受給 (公的年金)
    // -------------------------------------------------------------
    let annualPension = 0;
    if (age >= cfg.pension.startAge && cfg.pension.startAge > 0) {
      annualPension = (parseFloat(cfg.pension.monthly) || 0) * 12;
    }

    // -------------------------------------------------------------
    // 3. 取り崩し処理 (特定口座 → 旧NISA → 新NISA 順、現物株除外)
    // -------------------------------------------------------------
    let annualWithdrawTarget = 0;
    let actualWithdraw = 0;

    if (age >= cfg.withdraw.startAge && cfg.withdraw.startAge > 0) {
      if (cfg.withdraw.type === 'fixed-amount') {
        annualWithdrawTarget = (parseFloat(cfg.withdraw.monthly) || 0) * 12;
      } else {
        // 定率取り崩し (対象3口座の運用後残高合計に対する割合)
        const withdrawableTotal = balTaxable + balOldNisa + balNewNisa;
        const withdrawRate = (parseFloat(cfg.withdraw.rate) || 0) / 100;
        annualWithdrawTarget = withdrawableTotal * withdrawRate;
      }

      let remainingToWithdraw = annualWithdrawTarget;

      // 優先順位1位: 特定口座から取り崩し
      if (remainingToWithdraw > 0 && balTaxable > 0) {
        const drawTaxable = Math.min(balTaxable, remainingToWithdraw);
        balTaxable -= drawTaxable;
        remainingToWithdraw -= drawTaxable;
        actualWithdraw += drawTaxable;
      }

      // 優先順位2位: 旧NISAから取り崩し (移管前の残高がある場合、古い年度から順に取り崩す)
      if (remainingToWithdraw > 0 && balOldNisa > 0) {
        const drawOldNisa = Math.min(balOldNisa, remainingToWithdraw);
        let remDraw = drawOldNisa;
        for (const yr of oldNisaYears) {
          if (oldNisaSlots[yr] > 0 && remDraw > 0) {
            const d = Math.min(oldNisaSlots[yr], remDraw);
            oldNisaSlots[yr] -= d;
            remDraw -= d;
          }
        }
        balOldNisa = oldNisaYears.reduce((sum, yr) => sum + oldNisaSlots[yr], 0);
        remainingToWithdraw -= drawOldNisa;
        actualWithdraw += drawOldNisa;
      }

      // 優先順位3位: 新NISAから取り崩し
      if (remainingToWithdraw > 0 && balNewNisa > 0) {
        const drawNewNisa = Math.min(balNewNisa, remainingToWithdraw);
        balNewNisa -= drawNewNisa;
        remainingToWithdraw -= drawNewNisa;
        actualWithdraw += drawNewNisa;
      }

      // 株式現物は取り崩さない (温存)
    }

    const totalAssets = balTaxable + balOldNisa + balNewNisa + balDc + balStock;

    records.push({
      age,
      year: y,
      calYear,
      totalAssets: Math.round(totalAssets * 10) / 10,
      taxable: Math.round(balTaxable * 10) / 10,
      oldNisa: Math.round(balOldNisa * 10) / 10,
      newNisa: Math.round(balNewNisa * 10) / 10,
      dc: Math.round(balDc * 10) / 10,
      stock: Math.round(balStock * 10) / 10,
      annualContribute: Math.round(yearContributeTotal * 10) / 10,
      annualGain: Math.round(yearGainTotal * 10) / 10,
      annualPension: Math.round(annualPension * 10) / 10,
      dcTransfer: Math.round(dcTransferThisYear * 10) / 10,
      oldNisaTransfer: Math.round(oldNisaTransferThisYear * 10) / 10,
      annualWithdraw: Math.round(actualWithdraw * 10) / 10,
      targetWithdraw: Math.round(annualWithdrawTarget * 10) / 10
    });
  }

  // サマリー計算
  let peakAssetRecord = records[0] || { totalAssets: 0, age: currentAge };
  let totalPensionReceived = 0;
  for (const r of records) {
    if (r.totalAssets > peakAssetRecord.totalAssets) {
      peakAssetRecord = r;
    }
    totalPensionReceived += r.annualPension;
  }

  const record100 = records[records.length - 1] || { totalAssets: 0, taxable: 0, stock: 0 };

  return {
    records,
    summary: {
      peakAssets: peakAssetRecord.totalAssets,
      peakAge: peakAssetRecord.age,
      finalAssets: record100.totalAssets,
      finalTaxable: record100.taxable,
      finalStock: record100.stock,
      totalPension: Math.round(totalPensionReceived),
      dcNet: dcNetTransferred,
      dcTax: dcTaxPaid,
      nisaBookTotal: bookNewNisa
    }
  };
}

// ============================================================================
// UI Controllers & Renderers
// ============================================================================
let mainChartInstance = null;

/**
 * 実質計算対象期間バッジの更新
 */
function updateEffectivePatternBadges() {
  const currentAge = parseInt(state.currentAge, 10) || 0;
  const endAge = parseInt(state.endAge, 10) || 0;

  // 特定口座
  const taxableEff = calcEffectivePatterns(currentAge, endAge, state.accounts.taxable.patterns);
  taxableEff.forEach((eff, idx) => {
    const el = document.getElementById(`taxable-p${idx + 1}-effective`);
    if (!el) return;
    if (eff.effYears === 0) {
      el.textContent = '実質 0年 (対象外)';
      el.className = 'pattern-effective-badge badge-zero';
    } else if (eff.isCapped) {
      el.textContent = `実質 ${eff.effYears}年 (${eff.startAge}〜${eff.endAge}歳 ※短縮)`;
      el.className = 'pattern-effective-badge badge-capped';
    } else {
      el.textContent = `実質 ${eff.effYears}年 (${eff.startAge}〜${eff.endAge}歳)`;
      el.className = 'pattern-effective-badge';
    }
  });

  // 新NISA口座
  const newNisaEff = calcEffectivePatterns(currentAge, endAge, state.accounts.newNisa.patterns);
  newNisaEff.forEach((eff, idx) => {
    const el = document.getElementById(`newnisa-p${idx + 1}-effective`);
    if (!el) return;
    if (eff.effYears === 0) {
      el.textContent = '実質 0年 (対象外)';
      el.className = 'pattern-effective-badge badge-zero';
    } else if (eff.isCapped) {
      el.textContent = `実質 ${eff.effYears}年 (${eff.startAge}〜${eff.endAge}歳 ※短縮)`;
      el.className = 'pattern-effective-badge badge-capped';
    } else {
      el.textContent = `実質 ${eff.effYears}年 (${eff.startAge}〜${eff.endAge}歳)`;
      el.className = 'pattern-effective-badge';
    }
  });
}

/**
 * 旧NISA合計バッジおよび年度別移管年齢バッジの更新
 */
function updateOldNisaUIBadges() {
  let oldNisaTotal = 0;
  const oldNisaBaseYear = parseInt(state.accounts.oldNisa.baseYear, 10) || 2024;
  const currentAge = parseInt(state.currentAge, 10) || 35;
  const yearsObj = state.accounts.oldNisa.years || {};

  [2018, 2019, 2020, 2021, 2022, 2023].forEach(yr => {
    const val = yearsObj[yr] !== undefined ? yearsObj[yr] : 0;
    oldNisaTotal += parseFloat(val) || 0;

    const transYear = yr + 20; // 21年目移管（投資年 + 20年満了時）
    const transAge = currentAge + (transYear - oldNisaBaseYear);
    const badge = document.getElementById(`badge-oldnisa-trans-${yr}`);
    if (badge) {
      if (transYear <= oldNisaBaseYear) {
        badge.textContent = `${transYear}年 (移管済)`;
        badge.className = 'oldnisa-transfer-badge badge-capped';
      } else {
        badge.textContent = `${transYear}年移管 (${transAge}歳)`;
        badge.className = 'oldnisa-transfer-badge';
      }
    }
  });

  setText('disp-oldnisa-total', formatMoneyBadge(oldNisaTotal));
  setText('disp-oldnisa-rate', state.accounts.oldNisa.rate);
  setText('disp-oldnisa-base-year', state.accounts.oldNisa.baseYear);
  setText('sum-oldnisa', `合計 ${formatMoneyBadge(oldNisaTotal)}万 (2018〜2023年)`);
}

/**
 * フォーム上部バッジ・サマリーラベルの更新 (リアルタイム同期)
 */
function updateUIBadges() {
  // 基本プロファイル
  setText('disp-current-age', state.currentAge);
  setText('disp-end-age', state.endAge);

  // ① 特定口座
  setText('disp-taxable-initial', formatMoneyBadge(state.accounts.taxable.initial));
  setText('disp-taxable-rate', state.accounts.taxable.rate);
  setText('sum-taxable', `初期 ${formatMoneyBadge(state.accounts.taxable.initial)}万`);

  // ② 旧NISA
  setText('disp-oldnisa-rate', state.accounts.oldNisa.rate);
  setText('disp-oldnisa-base-year', state.accounts.oldNisa.baseYear);

  // ③ 新NISA
  setText('disp-newnisa-initial', formatMoneyBadge(state.accounts.newNisa.initial));
  setText('disp-newnisa-rate', state.accounts.newNisa.rate);
  setText('sum-newnisa', `初期 ${formatMoneyBadge(state.accounts.newNisa.initial)}万`);

  // ④ DC
  setText('disp-dc-initial', formatMoneyBadge(state.accounts.dc.initial));
  setText('disp-dc-monthly', state.accounts.dc.monthly);
  setText('disp-dc-rate', state.accounts.dc.rate);
  setText('disp-dc-receive-age', state.accounts.dc.receiveAge);
  setText('disp-dc-years-past', state.accounts.dc.yearsPast);
  setText('sum-dc', `初期 ${formatMoneyBadge(state.accounts.dc.initial)}万 / 拠出 ${state.accounts.dc.monthly}万`);

  // ⑤ 株式現物
  setText('disp-stock-initial', formatMoneyBadge(state.accounts.stock.initial));
  setText('disp-stock-monthly', state.accounts.stock.monthly);
  setText('disp-stock-rate', state.accounts.stock.rate);
  setText('sum-stock', `初期 ${formatMoneyBadge(state.accounts.stock.initial)}万 / 買増 ${state.accounts.stock.monthly}万`);

  // 公的年金
  setText('disp-pension-start-age', state.pension.startAge);
  setText('disp-pension-monthly', state.pension.monthly);
  setText('disp-pension-annual', Math.round(state.pension.monthly * 12));

  // 取り崩し
  setText('disp-withdraw-start-age', state.withdraw.startAge);
  setText('disp-withdraw-monthly', state.withdraw.monthly);
  setText('disp-withdraw-annual', Math.round(state.withdraw.monthly * 12));
  setText('disp-withdraw-rate', state.withdraw.rate);

  // NISA Progress
  const nisaInitial = parseFloat(state.accounts.newNisa.initial) || 0;
  const fillPct = Math.min(100, Math.round((nisaInitial / NISA_LIFETIME_LIMIT) * 100));
  const elFill = document.getElementById('nisa-limit-fill');
  if (elFill) elFill.style.width = `${fillPct}%`;
  setText('nisa-limit-fill-info', `${formatMoneyBadge(nisaInitial)}万 / 1,800万 (${fillPct}%)`);
}

/**
 * フォーム要素とStateのバインディング
 */
function syncStateToUI() {
  // 基本プロファイル
  setInputValue('range-current-age', state.currentAge);
  setInputValue('input-current-age', state.currentAge);

  setInputValue('range-end-age', state.endAge);
  setInputValue('input-end-age', state.endAge);

  // ① 特定口座
  setInputValue('range-taxable-initial', state.accounts.taxable.initial);
  setInputValue('taxable-initial', state.accounts.taxable.initial);
  setInputValue('taxable-rate', state.accounts.taxable.rate);

  // 特定口座 3パターン (期間・金額)
  const tPatterns = state.accounts.taxable.patterns || [];
  ['p1', 'p2', 'p3'].forEach((pKey, idx) => {
    const p = tPatterns[idx] || { years: 0, monthly: 0 };
    setInputValue(`taxable-${pKey}-years`, p.years);
    setInputValue(`taxable-${pKey}-monthly`, p.monthly);
  });

  // ② 旧NISA
  setInputValue('oldnisa-rate', state.accounts.oldNisa.rate);
  setInputValue('oldnisa-base-year', state.accounts.oldNisa.baseYear);

  const yearsObj = state.accounts.oldNisa.years || {};
  [2018, 2019, 2020, 2021, 2022, 2023].forEach(yr => {
    const val = yearsObj[yr] !== undefined ? yearsObj[yr] : 0;
    setInputValue(`oldnisa-val-${yr}`, val);
  });

  updateOldNisaUIBadges();

  // ③ 新NISA
  setInputValue('range-newnisa-initial', state.accounts.newNisa.initial);
  setInputValue('newnisa-initial', state.accounts.newNisa.initial);
  setInputValue('newnisa-rate', state.accounts.newNisa.rate);

  // 新NISA 3パターン (期間・金額)
  const nPatterns = state.accounts.newNisa.patterns || [];
  ['p1', 'p2', 'p3'].forEach((pKey, idx) => {
    const p = nPatterns[idx] || { years: 0, monthly: 0 };
    setInputValue(`newnisa-${pKey}-years`, p.years);
    setInputValue(`newnisa-${pKey}-monthly`, p.monthly);
  });

  // ④ DC
  setInputValue('range-dc-initial', state.accounts.dc.initial);
  setInputValue('dc-initial', state.accounts.dc.initial);
  setInputValue('dc-monthly', state.accounts.dc.monthly);
  setInputValue('dc-rate', state.accounts.dc.rate);
  setInputValue('dc-receive-age', state.accounts.dc.receiveAge);
  setInputValue('dc-years-past', state.accounts.dc.yearsPast);

  // ⑤ 株式現物
  setInputValue('range-stock-initial', state.accounts.stock.initial);
  setInputValue('stock-initial', state.accounts.stock.initial);
  setInputValue('stock-monthly', state.accounts.stock.monthly);
  setInputValue('stock-rate', state.accounts.stock.rate);

  // 公的年金
  setInputValue('pension-start-age', state.pension.startAge);
  setInputValue('pension-monthly', state.pension.monthly);

  // 取り崩し
  setInputValue('range-withdraw-start-age', state.withdraw.startAge);
  setInputValue('withdraw-start-age', state.withdraw.startAge);

  const radioType = document.querySelector(`input[name="withdraw-type"][value="${state.withdraw.type}"]`);
  if (radioType) radioType.checked = true;

  if (state.withdraw.type === 'fixed-amount') {
    const boxAmount = document.getElementById('box-withdraw-amount');
    const boxRate = document.getElementById('box-withdraw-rate');
    if (boxAmount) boxAmount.classList.remove('hidden');
    if (boxRate) boxRate.classList.add('hidden');
  } else {
    const boxAmount = document.getElementById('box-withdraw-amount');
    const boxRate = document.getElementById('box-withdraw-rate');
    if (boxAmount) boxAmount.classList.add('hidden');
    if (boxRate) boxRate.classList.remove('hidden');
  }

  setInputValue('range-withdraw-monthly', state.withdraw.monthly);
  setInputValue('withdraw-monthly', state.withdraw.monthly);
  setInputValue('range-withdraw-rate', state.withdraw.rate);
  setInputValue('withdraw-rate', state.withdraw.rate);

  // バッジ更新
  updateUIBadges();

  // 実質計算期間バッジ更新
  updateEffectivePatternBadges();
}

function setInputValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = (val !== undefined && val !== null) ? val : 0;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * UIからStateを読み取って更新
 */
function readStateFromUI() {
  const parseNum = (id, def = 0) => {
    const el = document.getElementById(id);
    if (!el) return def;
    const v = parseFloat(el.value);
    return isNaN(v) ? def : v;
  };

  const parseIntNum = (id, def = 0) => {
    const el = document.getElementById(id);
    if (!el) return def;
    const v = parseInt(el.value, 10);
    return isNaN(v) ? def : v;
  };

  state.currentAge = parseIntNum('input-current-age', 35);
  state.endAge = parseIntNum('input-end-age', 60);

  // ① 特定口座
  state.accounts.taxable.initial = parseNum('taxable-initial', 0);
  state.accounts.taxable.rate = parseNum('taxable-rate', 0);
  state.accounts.taxable.patterns = [
    {
      years: parseIntNum('taxable-p1-years', 0),
      monthly: parseNum('taxable-p1-monthly', 0)
    },
    {
      years: parseIntNum('taxable-p2-years', 0),
      monthly: parseNum('taxable-p2-monthly', 0)
    },
    {
      years: parseIntNum('taxable-p3-years', 0),
      monthly: parseNum('taxable-p3-monthly', 0)
    }
  ];

  // ② 旧NISA
  state.accounts.oldNisa.rate = parseNum('oldnisa-rate', 5.0);
  state.accounts.oldNisa.baseYear = parseIntNum('oldnisa-base-year', 2024);
  if (!state.accounts.oldNisa.years) state.accounts.oldNisa.years = {};
  [2018, 2019, 2020, 2021, 2022, 2023].forEach(yr => {
    state.accounts.oldNisa.years[yr] = parseNum(`oldnisa-val-${yr}`, 0);
  });

  // ③ 新NISA
  state.accounts.newNisa.initial = parseNum('newnisa-initial', 0);
  state.accounts.newNisa.rate = parseNum('newnisa-rate', 0);
  state.accounts.newNisa.patterns = [
    {
      years: parseIntNum('newnisa-p1-years', 0),
      monthly: parseNum('newnisa-p1-monthly', 0)
    },
    {
      years: parseIntNum('newnisa-p2-years', 0),
      monthly: parseNum('newnisa-p2-monthly', 0)
    },
    {
      years: parseIntNum('newnisa-p3-years', 0),
      monthly: parseNum('newnisa-p3-monthly', 0)
    }
  ];

  // ④ DC
  state.accounts.dc.initial = parseNum('dc-initial', 0);
  state.accounts.dc.monthly = parseNum('dc-monthly', 0);
  state.accounts.dc.rate = parseNum('dc-rate', 0);
  state.accounts.dc.receiveAge = parseIntNum('dc-receive-age', 60);
  state.accounts.dc.yearsPast = parseNum('dc-years-past', 0);

  // ⑤ 株式現物
  state.accounts.stock.initial = parseNum('stock-initial', 0);
  state.accounts.stock.monthly = parseNum('stock-monthly', 0);
  state.accounts.stock.rate = parseNum('stock-rate', 0);

  // 公的年金
  state.pension.startAge = parseIntNum('pension-start-age', 65);
  state.pension.monthly = parseNum('pension-monthly', 0);

  // 取り崩し
  state.withdraw.startAge = parseIntNum('withdraw-start-age', 65);
  const checkedRadio = document.querySelector('input[name="withdraw-type"]:checked');
  if (checkedRadio) state.withdraw.type = checkedRadio.value;

  state.withdraw.monthly = parseNum('withdraw-monthly', 0);
  state.withdraw.rate = parseNum('withdraw-rate', 0);

  // LocalStorageに保存
  saveStateToLocalStorage();
}

/**
 * シミュレーションの実行と全画面更新
 */
function updateSimulation() {
  readStateFromUI();
  updateUIBadges();
  const sim = runSimulation(state);

  // 実質計算期間バッジ更新
  updateEffectivePatternBadges();

  // 旧NISAバッジ・合計値更新
  updateOldNisaUIBadges();

  // 1. KPI更新
  setText('kpi-peak-assets', formatNumber(sim.summary.peakAssets));
  setText('kpi-peak-age', `${sim.summary.peakAge} 歳到達時`);
  setText('kpi-100-assets', formatNumber(sim.summary.finalAssets));
  setText('kpi-100-status', sim.summary.finalAssets > 0 ? (sim.summary.finalAssets > 2000 ? '資産潤沢' : '資産維持') : '資産枯渇');
  setText('kpi-dc-net', formatNumber(sim.summary.dcNet));
  setText('kpi-dc-tax-saved', `税引前: ${formatNumber(sim.summary.dcNet + sim.summary.dcTax)}万 (税額 ${formatNumber(sim.summary.dcTax)}万)`);
  setText('kpi-pension-total', formatNumber(sim.summary.totalPension));
  setText('kpi-pension-span', `${state.pension.startAge}歳〜100歳 (月${state.pension.monthly}万)`);

  // モバイル用サマリーバー & タブバッジ更新
  setText('summary-bar-peak', `${formatNumber(sim.summary.peakAssets)} 万`);
  setText('summary-bar-end', `${formatNumber(sim.summary.finalAssets)} 万`);
  setText('tab-badge-peak', `${formatNumber(sim.summary.peakAssets)} 万`);

  // DCプレビューボックス更新
  if (state.accounts.dc.receiveAge > 0 && sim.summary.dcNet > 0) {
    const grossDc = sim.summary.dcNet + sim.summary.dcTax;
    const totalDcYears = state.accounts.dc.yearsPast + (state.accounts.dc.receiveAge - state.currentAge);
    const taxInfo = calcRetirementTax(grossDc, totalDcYears);
    setText('preview-dc-total', formatNumber(grossDc));
    setText('preview-dc-years', `${taxInfo.years}`);
    setText('preview-dc-deduction', formatNumber(taxInfo.deduction));
    setText('preview-dc-tax', formatNumber(taxInfo.totalTax));
    setText('preview-dc-net', formatNumber(taxInfo.netAmount));
  } else {
    setText('preview-dc-total', '-');
    setText('preview-dc-years', '-');
    setText('preview-dc-deduction', '-');
    setText('preview-dc-tax', '-');
    setText('preview-dc-net', '-');
  }

  // 2. グラフ描画更新
  renderChart(sim.records);

  // 3. マイルストーン描画 (60歳〜100歳 10歳刻み)
  renderMilestones(sim.records);

  // 4. 全年齢詳細テーブル描画
  renderDetailTable(sim.records);
}

/**
 * マイルストーンの描画 (60, 70, 80, 90, 100歳)
 */
function renderMilestones(records) {
  const targetAges = [60, 70, 80, 90, 100];
  const container = document.getElementById('milestone-cards-container');
  const tableBody = document.getElementById('milestone-table-body');
  
  if (!container || !tableBody) return;

  container.innerHTML = '';
  tableBody.innerHTML = '';

  if (!records || records.length === 0) return;

  targetAges.forEach(targetAge => {
    // レコード取得 (存在しない場合は最終または最寄りのレコード)
    const rec = records.find(r => r.age === targetAge) || records[records.length - 1];
    if (!rec) return;

    // 健全性ステータス判定
    let statusClass = 'status-rich';
    let statusText = '潤沢';
    if (rec.totalAssets <= 0) {
      statusClass = 'status-depleted';
      statusText = '枯渇';
    } else if (rec.totalAssets < 1000) {
      statusClass = 'status-warning';
      statusText = '要注意';
    } else if (rec.totalAssets < 3000) {
      statusClass = 'status-stable';
      statusText = '安定';
    }

    // 1. マイルストーンカード生成
    const card = document.createElement('div');
    card.className = 'milestone-card';
    card.innerHTML = `
      <div class="m-header">
        <span class="m-age"><i data-lucide="calendar"></i> ${targetAge} 歳時点</span>
        <span class="m-status-badge ${statusClass}">${statusText}</span>
      </div>
      <div class="m-total">
        <span class="m-total-label">総資産額</span>
        <span class="m-total-val">${formatNumber(rec.totalAssets)} <small style="font-size:0.7rem;">万円</small></span>
      </div>
      <div class="m-breakdown">
        <div class="m-row"><span>特定口座:</span><strong>${formatNumber(rec.taxable)} 万</strong></div>
        <div class="m-row"><span>旧NISA:</span><strong>${formatNumber(rec.oldNisa)} 万</strong></div>
        <div class="m-row"><span>新NISA:</span><strong>${formatNumber(rec.newNisa)} 万</strong></div>
        <div class="m-row"><span>確定拠出(DC):</span><strong>${formatNumber(rec.dc)} 万</strong></div>
        <div class="m-row"><span>株式現物:</span><strong>${formatNumber(rec.stock)} 万</strong></div>
      </div>
      <div class="m-cashflow-row">
        <span>年金: <strong>${rec.annualPension > 0 ? formatNumber(rec.annualPension) + '万' : 'なし'}</strong></span>
        <span>取崩し: <strong>${rec.annualWithdraw > 0 ? formatNumber(rec.annualWithdraw) + '万' : '0万'}</strong></span>
      </div>
    `;
    container.appendChild(card);

    // 2. マイルストーンテーブル行生成
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${targetAge} 歳時点</strong> (経過${rec.year}年)</td>
      <td><strong style="color: var(--text-primary);">${formatNumber(rec.totalAssets)} 万円</strong></td>
      <td style="color: var(--col-taxable);">${formatNumber(rec.taxable)} 万円</td>
      <td style="color: var(--col-oldnisa);">${formatNumber(rec.oldNisa)} 万円</td>
      <td style="color: var(--col-newnisa);">${formatNumber(rec.newNisa)} 万円</td>
      <td style="color: var(--col-dc);">${formatNumber(rec.dc)} 万円</td>
      <td style="color: var(--col-stock);">${formatNumber(rec.stock)} 万円</td>
      <td>${rec.annualPension > 0 ? formatNumber(rec.annualPension) + ' 万円' : '-'}</td>
      <td style="color: ${rec.annualWithdraw > 0 ? 'var(--col-danger)' : 'inherit'};">${rec.annualWithdraw > 0 ? formatNumber(rec.annualWithdraw) + ' 万円' : '-'}</td>
      <td><span class="m-status-badge ${statusClass}">${statusText}</span></td>
    `;
    tableBody.appendChild(tr);
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/**
 * 全年齢詳細テーブルの描画
 */
function renderDetailTable(records) {
  const tableBody = document.getElementById('full-detail-table-body');
  if (!tableBody) return;

  tableBody.innerHTML = '';
  if (!records || records.length === 0) return;

    records.forEach(rec => {
      let transferText = '-';
      if (rec.dcTransfer > 0 && rec.oldNisaTransfer > 0) {
        transferText = `+${formatNumber(rec.dcTransfer)}万(DC) / +${formatNumber(rec.oldNisaTransfer)}万(旧NISA)`;
      } else if (rec.dcTransfer > 0) {
        transferText = `+${formatNumber(rec.dcTransfer)}万 (DC移管)`;
      } else if (rec.oldNisaTransfer > 0) {
        transferText = `+${formatNumber(rec.oldNisaTransfer)}万 (旧NISA移管)`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${rec.age} 歳</strong></td>
        <td>${rec.year}年目</td>
        <td><strong>${formatNumber(rec.totalAssets)} 万</strong></td>
        <td>${rec.annualContribute > 0 ? '+' + formatNumber(rec.annualContribute) + ' 万' : '-'}</td>
        <td style="color: ${rec.annualGain >= 0 ? 'var(--col-success)' : 'var(--col-danger)'};">${rec.annualGain >= 0 ? '+' : ''}${formatNumber(rec.annualGain)} 万</td>
        <td>${rec.annualPension > 0 ? formatNumber(rec.annualPension) + ' 万' : '-'}</td>
        <td style="color: ${rec.oldNisaTransfer > 0 ? 'var(--col-oldnisa)' : 'var(--col-dc)'}; font-size: 0.73rem;">${transferText}</td>
        <td style="color: var(--col-taxable);">${formatNumber(rec.taxable)} 万</td>
        <td style="color: var(--col-oldnisa);">${formatNumber(rec.oldNisa)} 万</td>
        <td style="color: var(--col-newnisa);">${formatNumber(rec.newNisa)} 万</td>
        <td style="color: var(--col-dc);">${formatNumber(rec.dc)} 万</td>
        <td style="color: var(--col-stock);">${formatNumber(rec.stock)} 万</td>
        <td style="color: ${rec.annualWithdraw > 0 ? 'var(--col-danger)' : 'inherit'};">${rec.annualWithdraw > 0 ? '-' + formatNumber(rec.annualWithdraw) + ' 万' : '-'}</td>
      `;
      tableBody.appendChild(tr);
    });

  setText('badge-table-rows', `${state.currentAge}歳〜100歳 (${records.length}行)`);
}

/**
 * Chart.js グラフ描画
 */
function renderChart(records) {
  const ctx = document.getElementById('mainChart');
  if (!ctx) return;

  if (!records || records.length === 0) {
    if (mainChartInstance) mainChartInstance.destroy();
    return;
  }

  const labels = records.map(r => `${r.age}歳`);

  const dataTaxable = records.map(r => r.taxable);
  const dataOldNisa = records.map(r => r.oldNisa);
  const dataNewNisa = records.map(r => r.newNisa);
  const dataDc = records.map(r => r.dc);
  const dataStock = records.map(r => r.stock);
  const dataTotal = records.map(r => r.totalAssets);

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
  const textColor = isDark ? '#9ca3af' : '#4b5563';

  if (mainChartInstance) {
    mainChartInstance.destroy();
  }

  if (state.chartType === 'stacked') {
    // 口座別積み上げ面グラフ
    mainChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '株式現物 (温存)',
            data: dataStock,
            backgroundColor: 'rgba(244, 63, 94, 0.55)',
            borderColor: '#f43f5e',
            borderWidth: 1.5,
            fill: true,
            tension: 0.25,
            pointRadius: 0
          },
          {
            label: '確定拠出年金 (DC)',
            data: dataDc,
            backgroundColor: 'rgba(139, 92, 246, 0.55)',
            borderColor: '#8b5cf6',
            borderWidth: 1.5,
            fill: true,
            tension: 0.25,
            pointRadius: 0
          },
          {
            label: '新NISA (非課税)',
            data: dataNewNisa,
            backgroundColor: 'rgba(16, 185, 129, 0.55)',
            borderColor: '#10b981',
            borderWidth: 1.5,
            fill: true,
            tension: 0.25,
            pointRadius: 0
          },
          {
            label: '旧NISA (移管前)',
            data: dataOldNisa,
            backgroundColor: 'rgba(245, 158, 11, 0.55)',
            borderColor: '#f59e0b',
            borderWidth: 1.5,
            fill: true,
            tension: 0.25,
            pointRadius: 0
          },
          {
            label: '特定口座 (課税)',
            data: dataTaxable,
            backgroundColor: 'rgba(6, 182, 212, 0.55)',
            borderColor: '#06b6d4',
            borderWidth: 1.5,
            fill: true,
            tension: 0.25,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(c) {
                return `${c.dataset.label}: ${formatNumber(c.parsed.y)} 万円`;
              },
              footer: function(items) {
                let sum = 0;
                items.forEach(i => sum += i.parsed.y);
                return `総資産額: ${formatNumber(sum)} 万円`;
              }
            }
          }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          y: { stacked: true, grid: { color: gridColor }, ticks: { color: textColor, callback: v => `${v}万` } }
        }
      }
    });
  } else if (state.chartType === 'cashflow') {
    // キャッシュフロー棒グラフ
    const dataContribute = records.map(r => r.annualContribute);
    const dataPension = records.map(r => r.annualPension);
    const dataWithdraw = records.map(r => -r.annualWithdraw);

    mainChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '年間積立拠出',
            data: dataContribute,
            backgroundColor: 'rgba(99, 102, 241, 0.7)',
            borderRadius: 4
          },
          {
            label: '公的年金受給',
            data: dataPension,
            backgroundColor: 'rgba(245, 158, 11, 0.7)',
            borderRadius: 4
          },
          {
            label: '資産取り崩し (支出)',
            data: dataWithdraw,
            backgroundColor: 'rgba(239, 68, 68, 0.7)',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', labels: { color: textColor, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: function(c) {
                return `${c.dataset.label}: ${formatNumber(Math.abs(c.parsed.y))} 万円`;
              }
            }
          }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => `${v}万` } }
        }
      }
    });
  } else {
    // 口座別推移線
    mainChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '総資産額',
            data: dataTotal,
            borderColor: '#ffffff',
            borderWidth: 2.5,
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: '特定口座',
            data: dataTaxable,
            borderColor: '#06b6d4',
            borderWidth: 1.8,
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: '旧NISA',
            data: dataOldNisa,
            borderColor: '#f59e0b',
            borderWidth: 1.8,
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: '新NISA',
            data: dataNewNisa,
            borderColor: '#10b981',
            borderWidth: 1.8,
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: '確定拠出年金 (DC)',
            data: dataDc,
            borderColor: '#8b5cf6',
            borderWidth: 1.8,
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: '株式現物',
            data: dataStock,
            borderColor: '#f43f5e',
            borderWidth: 1.8,
            tension: 0.2,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(c) {
                return `${c.dataset.label}: ${formatNumber(c.parsed.y)} 万円`;
              }
            }
          }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => `${v}万` } }
        }
      }
    });
  }
}

// ============================================================================
// JSON Export / Import & Storage
// ============================================================================

/**
 * 現在日時のタイムスタンプ文字列を取得 (YYYYMMDD_HHmmss)
 */
function getTimestampString() {
  const now = new Date();
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${YYYY}${MM}${DD}_${hh}${mm}${ss}`;
}

/**
 * 設定をJSONファイルとして保存 (保存先指定 & 時分秒付きファイル名)
 */
async function exportSettingsAsJSON() {
  readStateFromUI();
  const exportData = {
    appName: 'WealthBuildingSimulatorPro',
    version: '2.2.0',
    exportedAt: new Date().toISOString(),
    config: state
  };

  const jsonString = JSON.stringify(exportData, null, 2);
  const defaultFilename = `wealth_simulation_config_${getTimestampString()}.json`;

  // 1. File System Access API (保存先ダイアログ) のサポート判定
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultFilename,
        types: [
          {
            description: 'JSON Files (*.json)',
            accept: {
              'application/json': ['.json']
            }
          }
        ]
      });
      const writable = await handle.createWritable();
      await writable.write(jsonString);
      await writable.close();
      showToast('指定した場所に設定ファイルを保存しました', 'success');
      return;
    } catch (err) {
      if (err.name === 'AbortError') {
        // ユーザーが保存ダイアログをキャンセルした場合
        return;
      }
      console.warn('showSaveFilePicker failed, falling back to standard download:', err);
    }
  }

  // 2. フォールバック: 通常のダウンロード処理
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('設定をJSONファイルとしてダウンロード保存しました', 'success');
}

/**
 * JSONファイルを読み込んで設定を復元
 */
function importSettingsFromJSON(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const parsed = JSON.parse(evt.target.result);
      const config = parsed.config || parsed;
      if (!config.accounts) {
        throw new Error('有効なシミュレーター設定ファイルではありません');
      }

      state = normalizeState(config);
      syncStateToUI();
      updateSimulation();
      showToast('設定ファイルを正常に読み込みました', 'success');
    } catch (err) {
      showToast('ファイルの読み込みに失敗しました: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = ''; // リセット
}

/**
 * CSVエクスポート (保存先指定 & 時分秒付きファイル名)
 */
async function exportTableCSV() {
  const sim = runSimulation(state);
  let csv = `年齢,経過年,総資産額(万円),年間積立(万円),年間運用益(万円),公的年金(万円),DC受取移管(万円),旧NISA移管(万円),特定口座(万円),旧NISA(万円),新NISA(万円),確定拠出年金(万円),株式現物(万円),年間取崩し(万円)\n`;

  sim.records.forEach(r => {
    csv += `${r.age},${r.year},${r.totalAssets},${r.annualContribute},${r.annualGain},${r.annualPension},${r.dcTransfer},${r.oldNisaTransfer},${r.taxable},${r.oldNisa},${r.newNisa},${r.dc},${r.stock},${r.annualWithdraw}\n`;
  });

  const defaultFilename = `wealth_simulation_data_${getTimestampString()}.csv`;
  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });

  // 1. File System Access API
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultFilename,
        types: [
          {
            description: 'CSV Files (*.csv)',
            accept: {
              'text/csv': ['.csv']
            }
          }
        ]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      showToast('指定した場所にCSVファイルを保存しました', 'success');
      return;
    } catch (err) {
      if (err.name === 'AbortError') {
        return;
      }
      console.warn('showSaveFilePicker failed, falling back to standard download:', err);
    }
  }

  // 2. フォールバック
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('CSVファイルをダウンロードしました', 'success');
}

function normalizeState(config) {
  const merged = Object.assign({}, DEFAULT_STATE, config);
  if (!merged.accounts) merged.accounts = JSON.parse(JSON.stringify(DEFAULT_STATE.accounts));

  // 特定口座パターンの正規化
  merged.accounts.taxable = Object.assign({}, DEFAULT_STATE.accounts.taxable, merged.accounts.taxable || {});
  merged.accounts.taxable.patterns = normalizePatterns(merged.accounts.taxable.patterns, DEFAULT_STATE.accounts.taxable.patterns);

  // 旧NISA口座の正規化
  merged.accounts.oldNisa = Object.assign({}, DEFAULT_STATE.accounts.oldNisa, merged.accounts.oldNisa || {});
  if (!merged.accounts.oldNisa.years || typeof merged.accounts.oldNisa.years !== 'object') {
    const initialTotal = parseFloat(merged.accounts.oldNisa.initial) || 0;
    const perYear = Math.round((initialTotal / 6) * 10) / 10;
    merged.accounts.oldNisa.years = {
      2018: perYear,
      2019: perYear,
      2020: perYear,
      2021: perYear,
      2022: perYear,
      2023: Math.round((initialTotal - perYear * 5) * 10) / 10
    };
  } else {
    [2018, 2019, 2020, 2021, 2022, 2023].forEach(yr => {
      if (merged.accounts.oldNisa.years[yr] === undefined) {
        merged.accounts.oldNisa.years[yr] = 0;
      } else {
        merged.accounts.oldNisa.years[yr] = parseFloat(merged.accounts.oldNisa.years[yr]) || 0;
      }
    });
  }
  if (!merged.accounts.oldNisa.baseYear) {
    merged.accounts.oldNisa.baseYear = DEFAULT_STATE.accounts.oldNisa.baseYear;
  }

  // 新NISA口座パターンの正規化
  merged.accounts.newNisa = Object.assign({}, DEFAULT_STATE.accounts.newNisa, merged.accounts.newNisa || {});
  merged.accounts.newNisa.patterns = normalizePatterns(merged.accounts.newNisa.patterns, DEFAULT_STATE.accounts.newNisa.patterns);

  return merged;
}

function normalizePatterns(patterns, defaultPatterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return JSON.parse(JSON.stringify(defaultPatterns));
  }
  return [0, 1, 2].map(idx => {
    const p = patterns[idx] || (defaultPatterns[idx] || { years: 0, monthly: 0 });
    let years = 0;
    if (p.years !== undefined) {
      years = parseInt(p.years, 10) || 0;
    } else if (p.startAge !== undefined && p.endAge !== undefined) {
      years = Math.max(0, (parseInt(p.endAge, 10) || 0) - (parseInt(p.startAge, 10) || 0));
    } else if (idx === 0 && p.monthly > 0) {
      years = 10;
    }
    const monthly = parseFloat(p.monthly) || 0;
    return { years, monthly };
  });
}

/**
 * LocalStorage 保存 & 読込
 */
function saveStateToLocalStorage() {
  try {
    localStorage.setItem('wealth_sim_pro_state', JSON.stringify(state));
  } catch (e) {
    console.warn('LocalStorage error:', e);
  }
}

function loadStateFromLocalStorage() {
  try {
    const saved = localStorage.getItem('wealth_sim_pro_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      state = normalizeState(parsed);
    }
  } catch (e) {
    console.warn('LocalStorage load error:', e);
  }
}

/**
 * すべての入力数値をゼロにリセットする関数
 */
function resetAllToZero() {
  if (!confirm('すべての入力数値をゼロにリセットしますか？')) {
    return;
  }

  state = {
    currentAge: 0,
    endAge: 0,
    accounts: {
      taxable: {
        initial: 0,
        rate: 0,
        patterns: [
          { years: 0, monthly: 0 },
          { years: 0, monthly: 0 },
          { years: 0, monthly: 0 }
        ]
      },
      oldNisa: {
        baseYear: 2024,
        rate: 0,
        years: {
          2018: 0,
          2019: 0,
          2020: 0,
          2021: 0,
          2022: 0,
          2023: 0
        }
      },
      newNisa: {
        initial: 0,
        rate: 0,
        patterns: [
          { years: 0, monthly: 0 },
          { years: 0, monthly: 0 },
          { years: 0, monthly: 0 }
        ]
      },
      dc: {
        initial: 0,
        monthly: 0,
        rate: 0,
        receiveAge: 0,
        yearsPast: 0
      },
      stock: {
        initial: 0,
        monthly: 0,
        rate: 0
      }
    },
    pension: {
      startAge: 0,
      monthly: 0
    },
    withdraw: {
      startAge: 0,
      type: 'fixed-amount',
      monthly: 0,
      rate: 0
    },
    chartType: state.chartType || 'stacked',
    theme: state.theme || 'dark',
    detailTableOpen: state.detailTableOpen || false
  };

  syncStateToUI();
  updateSimulation();
  showToast('すべての入力数値をゼロにリセットしました', 'info');
}

// ============================================================================
// Utilities & Helpers
// ============================================================================
function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Number(num).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
}

function formatMoneyBadge(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  const val = parseFloat(num);
  if (val >= 10000) {
    const oku = (val / 10000).toFixed(1).replace(/\.0$/, '');
    return `${oku}億 (${formatNumber(val)})`;
  }
  return formatNumber(val);
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}"></i> <span>${msg}</span>`;
  container.appendChild(toast);

  if (window.lucide) window.lucide.createIcons();

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s ease-in forwards';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  }, 3500);
}

// ============================================================================
// Event Listeners Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // 1. LocalStorageから設定復元
  loadStateFromLocalStorage();

  // 2. テーマ初期化
  const savedTheme = localStorage.getItem('wealth_sim_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  // 3. UIとState同期 & 初回シミュレーション実行
  syncStateToUI();
  updateSimulation();

  // 4. イベントリスナー登録

  const RANGE_TO_INPUT = {
    'range-current-age': 'input-current-age',
    'range-end-age': 'input-end-age',
    'range-taxable-initial': 'taxable-initial',
    'range-newnisa-initial': 'newnisa-initial',
    'range-dc-initial': 'dc-initial',
    'range-stock-initial': 'stock-initial',
    'range-withdraw-start-age': 'withdraw-start-age',
    'range-withdraw-monthly': 'withdraw-monthly',
    'range-withdraw-rate': 'withdraw-rate',
  };

  function updateSliderFill(rangeEl) {
    if (!rangeEl) return;
    const min = parseFloat(rangeEl.min) || 0;
    const max = parseFloat(rangeEl.max) || 100;
    const val = parseFloat(rangeEl.value) || 0;
    const pct = Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));
    rangeEl.style.background = `linear-gradient(to right, var(--col-primary) 0%, var(--col-primary) ${pct}%, var(--border-color) ${pct}%, var(--border-color) 100%)`;
  }

  function updateAllSliderFills() {
    Object.keys(RANGE_TO_INPUT).forEach(rId => {
      const el = document.getElementById(rId);
      if (el) updateSliderFill(el);
    });
  }

  // スライダー初期塗りつぶし
  updateAllSliderFills();

  // 各スライダーと数値入力の個別直接イベントバインド (100% 確実な連動)
  Object.keys(RANGE_TO_INPUT).forEach(rangeId => {
    const rangeEl = document.getElementById(rangeId);
    const numId = RANGE_TO_INPUT[rangeId];
    const numEl = document.getElementById(numId);

    if (rangeEl) {
      const onRangeChange = (e) => {
        if (numEl) numEl.value = rangeEl.value;
        updateSliderFill(rangeEl);
        updateSimulation();
      };
      rangeEl.addEventListener('input', onRangeChange);
      rangeEl.addEventListener('change', onRangeChange);
    }

    if (numEl) {
      const onNumChange = (e) => {
        if (rangeEl) {
          rangeEl.value = numEl.value;
          updateSliderFill(rangeEl);
        }
        updateSimulation();
      };
      numEl.addEventListener('input', onNumChange);
      numEl.addEventListener('change', onNumChange);
    }
  });

  // 全体フォーム変更リスナー (他の全入力フィールド・ラジオ対応)
  const form = document.getElementById('sim-form');
  if (form) {
    form.addEventListener('input', (e) => {
      // 取り崩しラジオ切り替え時の表示制御
      if (e.target.name === 'withdraw-type') {
        if (e.target.value === 'fixed-amount') {
          const bAmount = document.getElementById('box-withdraw-amount');
          const bRate = document.getElementById('box-withdraw-rate');
          if (bAmount) bAmount.classList.remove('hidden');
          if (bRate) bRate.classList.add('hidden');
        } else {
          const bAmount = document.getElementById('box-withdraw-amount');
          const bRate = document.getElementById('box-withdraw-rate');
          if (bAmount) bAmount.classList.add('hidden');
          if (bRate) bRate.classList.remove('hidden');
        }
      }

      updateSimulation();
    });

    form.addEventListener('change', (e) => {
      updateSimulation();
    });
  }

  // アコーディオン開閉
  document.querySelectorAll('.acc-header').forEach(header => {
    header.addEventListener('click', () => {
      const box = header.closest('.account-box');
      if (box) {
        box.classList.toggle('collapsed');
      }
    });
  });

  // グラフ切り替えボタン
  document.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chartType = btn.dataset.chart;
      updateSimulation();
    });
  });

  // JSONファイル保存
  const btnSaveJson = document.getElementById('btn-save-json');
  if (btnSaveJson) btnSaveJson.addEventListener('click', exportSettingsAsJSON);

  // JSONファイル読込
  const btnLoadJson = document.getElementById('btn-load-json');
  const inputJson = document.getElementById('input-file-json');
  if (btnLoadJson && inputJson) {
    btnLoadJson.addEventListener('click', () => inputJson.click());
    inputJson.addEventListener('change', importSettingsFromJSON);
  }

  // CSV出力
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnTableCsv = document.getElementById('btn-table-download-csv');
  if (btnExportCsv) btnExportCsv.addEventListener('click', exportTableCSV);
  if (btnTableCsv) btnTableCsv.addEventListener('click', exportTableCSV);

  // テーマ切り替え
  const btnTheme = document.getElementById('btn-theme-toggle');
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('wealth_sim_theme', next);
      updateThemeIcon(next);
      updateSimulation();
    });
  }

  // 全数値をゼロにリセット
  const btnResetZero = document.getElementById('btn-reset-zero');
  if (btnResetZero) {
    btnResetZero.addEventListener('click', resetAllToZero);
  }

  // 詳細テーブル開閉
  const btnToggleDetail = document.getElementById('btn-toggle-detail-table');
  const boxDetail = document.getElementById('box-detail-table');
  const iconDetail = document.getElementById('icon-detail-table');
  if (btnToggleDetail && boxDetail) {
    boxDetail.classList.add('collapsed'); // デフォルトは閉じておく
    btnToggleDetail.addEventListener('click', () => {
      boxDetail.classList.toggle('collapsed');
      if (iconDetail) {
        iconDetail.style.transform = boxDetail.classList.contains('collapsed') ? 'rotate(0deg)' : 'rotate(180deg)';
      }
    });
  }

  // 旧NISA 均等配分ボタン
  const btnDistribute = document.getElementById('btn-oldnisa-distribute');
  if (btnDistribute) {
    btnDistribute.addEventListener('click', () => {
      let currentTotal = 0;
      [2018, 2019, 2020, 2021, 2022, 2023].forEach(yr => {
        currentTotal += parseFloat(state.accounts.oldNisa.years[yr]) || 0;
      });
      const input = prompt('旧NISAの合計評価額（万円）を入力してください。\n2018年〜2023年の6年分に均等配分します。', Math.round(currentTotal) || 240);
      if (input !== null && input.trim() !== '') {
        const val = parseFloat(input);
        if (!isNaN(val) && val >= 0) {
          const perYear = Math.round((val / 6) * 10) / 10;
          [2018, 2019, 2020, 2021, 2022, 2023].forEach((yr, idx) => {
            if (idx === 5) {
              state.accounts.oldNisa.years[yr] = Math.round((val - perYear * 5) * 10) / 10;
            } else {
              state.accounts.oldNisa.years[yr] = perYear;
            }
          });
          syncStateToUI();
          updateSimulation();
          showToast(`旧NISA合計 ${val}万円 を各年度に均等配分しました`, 'success');
        }
      }
    });
  }

  // モバイルタブ切り替えハンドラ
  function switchMobileTab(target) {
    const tabInputs = document.getElementById('tab-btn-inputs');
    const tabResults = document.getElementById('tab-btn-results');
    if (target === 'results') {
      document.body.classList.remove('tab-active-inputs');
      document.body.classList.add('tab-active-results');
      if (tabInputs) tabInputs.classList.remove('active');
      if (tabResults) tabResults.classList.add('active');
      if (mainChartInstance) {
        setTimeout(() => mainChartInstance.resize(), 60);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      document.body.classList.remove('tab-active-results');
      document.body.classList.add('tab-active-inputs');
      if (tabInputs) tabInputs.classList.add('active');
      if (tabResults) tabResults.classList.remove('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  const tabInputs = document.getElementById('tab-btn-inputs');
  const tabResults = document.getElementById('tab-btn-results');
  if (tabInputs) tabInputs.addEventListener('click', () => switchMobileTab('inputs'));
  if (tabResults) tabResults.addEventListener('click', () => switchMobileTab('results'));

  const btnJump = document.getElementById('btn-summary-jump-results');
  if (btnJump) {
    btnJump.addEventListener('click', () => {
      switchMobileTab('results');
    });
  }

  // デフォルトタブ設定
  document.body.classList.add('tab-active-inputs');

  // ウィンドウリサイズ時のグラフリサイズ自動追従
  window.addEventListener('resize', () => {
    if (mainChartInstance) {
      mainChartInstance.resize();
    }
  });

  // Lucideアイコン初期化
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function updateThemeIcon(theme) {
  const iconLight = document.getElementById('icon-theme-light');
  const iconDark = document.getElementById('icon-theme-dark');
  if (iconLight && iconDark) {
    if (theme === 'light') {
      iconLight.classList.remove('hidden');
      iconDark.classList.add('hidden');
    } else {
      iconLight.classList.add('hidden');
      iconDark.classList.remove('hidden');
    }
  }
}
