/**
 * 資産形成シミュレータ PRO (Wealth Simulator Pro)
 * Core Application Engine & Interactive Logic
 */

// ============================================================================
// State Management
// ============================================================================
const state = {
  activeTab: 'accumulate',
  chartType: 'area',
  theme: localStorage.getItem('wealth_sim_theme') || 'dark',
  tableVisible: false,
  
  // Tab 1: Accumulate (積立投資・新NISA)
  accumulate: {
    initial: 100, // 万円
    monthly: 5.0, // 万円
    rate: 5.0,    // %
    years: 20,    // 年
    startAge: 30, // 歳
    nisaEnabled: true,
    inflation: 0.0 // %
  },

  // Tab 2: Goal (目標逆算)
  goal: {
    target: 3000, // 万円
    years: 20,    // 年
    initial: 100, // 万円
    rate: 5.0     // %
  },

  // Tab 3: FIRE (取り崩し)
  fire: {
    assets: 5000,      // 万円
    type: 'fixed-amount', // 'fixed-amount' | 'fixed-rate'
    monthly: 20.0,     // 万円
    ratePct: 4.0,      // %
    returnRate: 3.0,   // %
    startAge: 60,      // 歳
    years: 35          // 年
  },

  // Tab 4: Life Plan (ライフイベント)
  lifeplan: {
    initial: 200,
    monthly: 6.0,
    rate: 5.0,
    years: 30,
    events: [
      { id: 'evt-1', name: 'マイホーム購入頭金', year: 5, amount: -500 },
      { id: 'evt-2', name: '子どもの大学入学', year: 15, amount: -400 },
      { id: 'evt-3', name: '退職金一時金', year: 30, amount: 1500 }
    ]
  },

  // Tab 5: Compare (シナリオ比較)
  compare: {
    planA: { monthly: 3.0, rate: 3.0 },
    planB: { monthly: 5.0, rate: 5.0 },
    planC: { monthly: 10.0, rate: 7.0 },
    years: 25,
    initial: 100
  },

  // Cached Calculation Results
  results: null
};

// Preset Configurations
const PRESETS = {
  'all-country': {
    initial: 50,
    monthly: 5.0,
    rate: 5.0,
    years: 25,
    startAge: 30,
    nisaEnabled: true
  },
  'sp500': {
    initial: 100,
    monthly: 10.0,
    rate: 7.0,
    years: 20,
    startAge: 28,
    nisaEnabled: true
  },
  'nisa-max': {
    initial: 240,
    monthly: 30.0,
    rate: 6.0,
    years: 20,
    startAge: 30,
    nisaEnabled: true
  },
  'starter': {
    initial: 10,
    monthly: 1.0,
    rate: 4.0,
    years: 30,
    startAge: 24,
    nisaEnabled: true
  }
};

// ============================================================================
// Mathematical / Financial Calculation Engines
// ============================================================================
const NISA_LIMIT = 1800; // 万円 (生涯非課税保有限度額)
const TAX_RATE = 0.20315; // 20.315% (所得税・復興特別所得税・住民税)

const CalcEngine = {
  /**
   * 積立投資 & 新NISAシミュレーション
   */
  calculateAccumulate(params) {
    const { initial, monthly, rate, years, startAge, nisaEnabled, inflation } = params;
    const monthlyRate = rate / 100 / 12;
    const totalMonths = years * 12;

    let balance = initial;
    let totalInvested = initial;
    let nisaInvested = Math.min(initial, NISA_LIMIT);
    let taxableInvested = Math.max(0, initial - NISA_LIMIT);

    const yearlyData = [];
    
    // Year 0 record
    yearlyData.push({
      year: 0,
      age: startAge,
      invested: totalInvested,
      profit: 0,
      balance: balance,
      realBalance: balance,
      interestThisYear: 0,
      nisaBalance: nisaInvested,
      taxableProfit: 0,
      taxSaved: 0,
      netBalance: balance
    });

    let prevYearEndBalance = balance;

    for (let m = 1; m <= totalMonths; m++) {
      // 1ヶ月分の利息計算
      const monthlyInterest = balance * monthlyRate;
      balance += monthlyInterest + monthly;
      totalInvested += monthly;

      // NISA枠管理
      if (nisaInvested + monthly <= NISA_LIMIT) {
        nisaInvested += monthly;
      } else {
        const remainingNisa = Math.max(0, NISA_LIMIT - nisaInvested);
        nisaInvested += remainingNisa;
        taxableInvested += (monthly - remainingNisa);
      }

      // 年末時点の集計 (12ヶ月ごと)
      if (m % 12 === 0) {
        const currentYear = m / 12;
        const profit = balance - totalInvested;
        const interestThisYear = balance - prevYearEndBalance - (monthly * 12);
        prevYearEndBalance = balance;

        // 税金計算
        let taxSaved = 0;
        let netBalance = balance;
        if (nisaEnabled) {
          if (taxableInvested > 0) {
            // NISA枠外の比率に応じて課税
            const taxableRatio = taxableInvested / totalInvested;
            const taxableProfit = Math.max(0, profit * taxableRatio);
            const tax = taxableProfit * TAX_RATE;
            netBalance = balance - tax;
            const nisaProfit = profit - taxableProfit;
            taxSaved = nisaProfit * TAX_RATE;
          } else {
            // 全額NISA内
            taxSaved = Math.max(0, profit * TAX_RATE);
            netBalance = balance;
          }
        } else {
          // NISA不使用 (全額課税口座)
          const tax = Math.max(0, profit * TAX_RATE);
          netBalance = balance - tax;
          taxSaved = 0;
        }

        // インフレ調整 (現在価値換算)
        const inflationFactor = Math.pow(1 + (inflation / 100), currentYear);
        const realBalance = netBalance / inflationFactor;

        yearlyData.push({
          year: currentYear,
          age: startAge + currentYear,
          invested: Math.round(totalInvested * 10) / 10,
          profit: Math.round(profit * 10) / 10,
          balance: Math.round(balance * 10) / 10,
          realBalance: Math.round(realBalance * 10) / 10,
          interestThisYear: Math.round(interestThisYear * 10) / 10,
          nisaBalance: Math.round(nisaInvested * 10) / 10,
          taxSaved: Math.round(taxSaved * 10) / 10,
          netBalance: Math.round(netBalance * 10) / 10
        });
      }
    }

    const finalRow = yearlyData[yearlyData.length - 1];
    return {
      type: 'accumulate',
      yearlyData,
      summary: {
        totalBalance: finalRow.netBalance,
        grossBalance: finalRow.balance,
        totalInvested: finalRow.invested,
        totalProfit: Math.max(0, finalRow.netBalance - finalRow.invested),
        profitPercent: finalRow.invested > 0 ? ((finalRow.netBalance - finalRow.invested) / finalRow.invested * 100) : 0,
        taxSaved: finalRow.taxSaved,
        realBalance: finalRow.realBalance
      }
    };
  },

  /**
   * 目標金額からの逆算シミュレーション
   */
  calculateGoal(params) {
    const { target, years, initial, rate } = params;
    const monthlyRate = rate / 100 / 12;
    const totalMonths = years * 12;

    // 初期投資の将来価値
    const futureInitial = initial * Math.pow(1 + monthlyRate, totalMonths);
    const remainingTarget = Math.max(0, target - futureInitial);

    // 月々の必要積立額 (年金終価係数の逆数)
    let requiredMonthly = 0;
    if (monthlyRate > 0) {
      requiredMonthly = (remainingTarget * monthlyRate) / (Math.pow(1 + monthlyRate, totalMonths) - 1);
    } else {
      requiredMonthly = remainingTarget / totalMonths;
    }

    // 計算した毎月積立額を用いて年次推移を生成
    const accumulateResult = this.calculateAccumulate({
      initial: initial,
      monthly: Math.max(0, requiredMonthly),
      rate: rate,
      years: years,
      startAge: 30,
      nisaEnabled: true,
      inflation: 0
    });

    return {
      type: 'goal',
      yearlyData: accumulateResult.yearlyData,
      requiredMonthly: Math.round(requiredMonthly * 10) / 10,
      target: target,
      summary: {
        totalBalance: accumulateResult.summary.totalBalance,
        totalInvested: accumulateResult.summary.totalInvested,
        totalProfit: accumulateResult.summary.totalProfit,
        profitPercent: accumulateResult.summary.profitPercent,
        requiredMonthly: Math.round(requiredMonthly * 10) / 10,
        yearsToTarget: years
      }
    };
  },

  /**
   * FIRE・取り崩しシミュレーション
   */
  calculateFire(params) {
    const { assets, type, monthly, ratePct, returnRate, startAge, years } = params;
    const monthlyReturnRate = returnRate / 100 / 12;
    const totalMonths = years * 12;

    let balance = assets;
    let totalWithdrawn = 0;
    let depletedAge = null;
    let depletedYear = null;

    const yearlyData = [];
    yearlyData.push({
      year: 0,
      age: startAge,
      balance: balance,
      totalWithdrawn: 0,
      annualWithdrawal: 0,
      annualInterest: 0
    });

    let prevBalance = balance;
    let yearWithdrawalSum = 0;

    for (let m = 1; m <= totalMonths; m++) {
      if (balance <= 0) {
        if (!depletedYear) {
          depletedYear = Math.ceil(m / 12);
          depletedAge = startAge + depletedYear;
        }
        balance = 0;
      } else {
        // 月初に取り崩し額を決定
        let withdrawAmount = 0;
        if (type === 'fixed-amount') {
          withdrawAmount = monthly;
        } else {
          // 定率取り崩し (年率 ratePct% / 12)
          withdrawAmount = balance * (ratePct / 100 / 12);
        }

        const actualWithdraw = Math.min(balance, withdrawAmount);
        balance -= actualWithdraw;
        totalWithdrawn += actualWithdraw;
        yearWithdrawalSum += actualWithdraw;

        // 残額を運用
        const interest = balance * monthlyReturnRate;
        balance += interest;
      }

      if (m % 12 === 0) {
        const currentYear = m / 12;
        const currentAge = startAge + currentYear;
        const annualInterest = balance - prevBalance + yearWithdrawalSum;
        prevBalance = balance;

        yearlyData.push({
          year: currentYear,
          age: currentAge,
          balance: Math.round(balance * 10) / 10,
          totalWithdrawn: Math.round(totalWithdrawn * 10) / 10,
          annualWithdrawal: Math.round(yearWithdrawalSum * 10) / 10,
          annualInterest: Math.round(annualInterest * 10) / 10
        });

        yearWithdrawalSum = 0;
      }
    }

    const finalRow = yearlyData[yearlyData.length - 1];
    return {
      type: 'fire',
      yearlyData,
      depletedAge,
      depletedYear,
      summary: {
        remainingBalance: finalRow.balance,
        totalWithdrawn: Math.round(totalWithdrawn * 10) / 10,
        initialAssets: assets,
        depletedAge: depletedAge,
        isSustained: balance > 0
      }
    };
  },

  /**
   * ライフイベント連動シミュレーション
   */
  calculateLifePlan(params) {
    const { initial, monthly, rate, years, events } = params;
    const monthlyRate = rate / 100 / 12;
    const totalMonths = years * 12;

    let balance = initial;
    let totalInvested = initial;
    const startAge = 30;

    const yearlyData = [];
    yearlyData.push({
      year: 0,
      age: startAge,
      invested: totalInvested,
      profit: 0,
      balance: balance,
      eventImpact: 0
    });

    for (let m = 1; m <= totalMonths; m++) {
      balance += (balance * monthlyRate) + monthly;
      totalInvested += monthly;

      // 年末時点
      if (m % 12 === 0) {
        const currentYear = m / 12;
        
        // 当該年に発生するイベントを反映
        let eventNet = 0;
        const yearEvents = events.filter(e => e.year === currentYear);
        for (const evt of yearEvents) {
          eventNet += evt.amount;
        }

        balance += eventNet;
        if (balance < 0) balance = 0;

        yearlyData.push({
          year: currentYear,
          age: startAge + currentYear,
          invested: Math.round(totalInvested * 10) / 10,
          profit: Math.round(Math.max(0, balance - totalInvested) * 10) / 10,
          balance: Math.round(balance * 10) / 10,
          eventImpact: eventNet
        });
      }
    }

    const finalRow = yearlyData[yearlyData.length - 1];
    return {
      type: 'lifeplan',
      yearlyData,
      summary: {
        totalBalance: finalRow.balance,
        totalInvested: finalRow.invested,
        totalProfit: Math.max(0, finalRow.balance - finalRow.invested),
        profitPercent: finalRow.invested > 0 ? ((finalRow.balance - finalRow.invested) / finalRow.invested * 100) : 0,
        eventCount: events.length
      }
    };
  },

  /**
   * シナリオ比較 (Plan A / B / C)
   */
  calculateCompare(params) {
    const { planA, planB, planC, years, initial } = params;

    const resA = this.calculateAccumulate({ initial, monthly: planA.monthly, rate: planA.rate, years, startAge: 30, nisaEnabled: true, inflation: 0 });
    const resB = this.calculateAccumulate({ initial, monthly: planB.monthly, rate: planB.rate, years, startAge: 30, nisaEnabled: true, inflation: 0 });
    const resC = this.calculateAccumulate({ initial, monthly: planC.monthly, rate: planC.rate, years, startAge: 30, nisaEnabled: true, inflation: 0 });

    return {
      type: 'compare',
      planA: resA,
      planB: resB,
      planC: resC,
      years
    };
  }
};

// ============================================================================
// UI & Chart Renderer
// ============================================================================
let mainChartInstance = null;
let donutChartInstance = null;

const ChartManager = {
  initCharts() {
    const ctxMain = document.getElementById('mainChart').getContext('2d');
    const ctxDonut = document.getElementById('donutChart').getContext('2d');

    const isDark = state.theme === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#94a3b8' : '#475569';

    // Main Chart
    mainChartInstance = new Chart(ctxMain, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: textColor,
              font: { family: 'Plus Jakarta Sans', size: 12, weight: '600' },
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16
            }
          },
          tooltip: {
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: isDark ? '#f8fafc' : '#0f172a',
            bodyColor: isDark ? '#cbd5e1' : '#334155',
            borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
            borderWidth: 1,
            padding: 12,
            boxPadding: 6,
            usePointStyle: true,
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) label += ': ';
                const val = context.parsed.y;
                if (val !== null) {
                  label += formatMoneyJapanese(val);
                }
                return label;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: 'Outfit', size: 11 }
            }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: 'Outfit', size: 11 },
              callback: function(value) {
                if (value >= 10000) return (value / 10000) + '億円';
                return value + '万';
              }
            }
          }
        },
        animation: {
          duration: 600,
          easing: 'easeOutQuart'
        }
      }
    });

    // Donut Chart
    donutChartInstance = new Chart(ctxDonut, {
      type: 'doughnut',
      data: {
        labels: ['投資元本', '運用収益'],
        datasets: [{
          data: [100, 0],
          backgroundColor: ['#38bdf8', '#10b981'],
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: isDark ? '#f8fafc' : '#0f172a',
            bodyColor: isDark ? '#cbd5e1' : '#334155',
            callbacks: {
              label: function(context) {
                const val = context.parsed;
                return `${context.label}: ${formatMoneyJapanese(val)}`;
              }
            }
          }
        }
      }
    });
  },

  updateCharts(results) {
    if (!mainChartInstance) return;

    const isDark = state.theme === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#94a3b8' : '#475569';

    mainChartInstance.options.scales.x.grid.color = gridColor;
    mainChartInstance.options.scales.y.grid.color = gridColor;
    mainChartInstance.options.scales.x.ticks.color = textColor;
    mainChartInstance.options.scales.y.ticks.color = textColor;
    mainChartInstance.options.plugins.legend.labels.color = textColor;

    const donutContainer = document.getElementById('donut-container');

    if (results.type === 'accumulate' || results.type === 'goal' || results.type === 'lifeplan') {
      donutContainer.classList.remove('hidden');
      const labels = results.yearlyData.map(d => `${d.year}年後 (${d.age}歳)`);
      const investedData = results.yearlyData.map(d => d.invested);
      const profitData = results.yearlyData.map(d => Math.max(0, d.netBalance !== undefined ? d.netBalance - d.invested : d.balance - d.invested));

      if (state.chartType === 'area') {
        mainChartInstance.config.type = 'line';
        mainChartInstance.data = {
          labels,
          datasets: [
            {
              label: '投資元本',
              data: investedData,
              backgroundColor: 'rgba(56, 189, 248, 0.45)',
              borderColor: '#38bdf8',
              borderWidth: 2,
              fill: 'origin',
              tension: 0.3,
              pointRadius: 2
            },
            {
              label: '運用益 (総資産)',
              data: results.yearlyData.map(d => d.netBalance !== undefined ? d.netBalance : d.balance),
              backgroundColor: 'rgba(16, 185, 129, 0.35)',
              borderColor: '#10b981',
              borderWidth: 2.5,
              fill: 0,
              tension: 0.3,
              pointRadius: 2
            }
          ]
        };
      } else if (state.chartType === 'bar') {
        mainChartInstance.config.type = 'bar';
        mainChartInstance.data = {
          labels,
          datasets: [
            {
              label: '投資元本',
              data: investedData,
              backgroundColor: '#38bdf8',
              borderRadius: 4,
              stack: 'stack0'
            },
            {
              label: '運用益',
              data: profitData,
              backgroundColor: '#10b981',
              borderRadius: 4,
              stack: 'stack0'
            }
          ]
        };
      } else {
        // Line chart
        mainChartInstance.config.type = 'line';
        mainChartInstance.data = {
          labels,
          datasets: [
            {
              label: '投資元本',
              data: investedData,
              borderColor: '#38bdf8',
              backgroundColor: 'transparent',
              borderWidth: 2,
              tension: 0.2,
              pointRadius: 3
            },
            {
              label: '総資産額',
              data: results.yearlyData.map(d => d.netBalance !== undefined ? d.netBalance : d.balance),
              borderColor: '#10b981',
              backgroundColor: 'transparent',
              borderWidth: 2.5,
              tension: 0.2,
              pointRadius: 3
            }
          ]
        };
      }

      // Update Donut Chart
      const finalInvested = results.summary.totalInvested;
      const finalProfit = results.summary.totalProfit;
      donutChartInstance.data.datasets[0].data = [finalInvested, finalProfit];
      donutChartInstance.update();

      document.getElementById('legend-principal-val').innerText = formatMoneyJapanese(finalInvested);
      document.getElementById('legend-profit-val').innerText = formatMoneyJapanese(finalProfit);

    } else if (results.type === 'fire') {
      donutContainer.classList.add('hidden');
      const labels = results.yearlyData.map(d => `${d.year}年目 (${d.age}歳)`);
      const balanceData = results.yearlyData.map(d => d.balance);
      const withdrawnData = results.yearlyData.map(d => d.totalWithdrawn);

      mainChartInstance.config.type = 'line';
      mainChartInstance.data = {
        labels,
        datasets: [
          {
            label: '資産残高',
            data: balanceData,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.2)',
            fill: true,
            borderWidth: 2.5,
            tension: 0.2,
            pointRadius: 2
          },
          {
            label: '累計取崩額',
            data: withdrawnData,
            borderColor: '#f43f5e',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 5],
            tension: 0.2,
            pointRadius: 2
          }
        ]
      };

    } else if (results.type === 'compare') {
      donutContainer.classList.add('hidden');
      const labels = results.planA.yearlyData.map(d => `${d.year}年後`);

      mainChartInstance.config.type = 'line';
      mainChartInstance.data = {
        labels,
        datasets: [
          {
            label: `プランA (月${state.compare.planA.monthly}万 / ${state.compare.planA.rate}%)`,
            data: results.planA.yearlyData.map(d => d.netBalance),
            borderColor: '#38bdf8',
            borderWidth: 2.5,
            tension: 0.2,
            pointRadius: 2
          },
          {
            label: `プランB (月${state.compare.planB.monthly}万 / ${state.compare.planB.rate}%)`,
            data: results.planB.yearlyData.map(d => d.netBalance),
            borderColor: '#818cf8',
            borderWidth: 2.5,
            tension: 0.2,
            pointRadius: 2
          },
          {
            label: `プランC (月${state.compare.planC.monthly}万 / ${state.compare.planC.rate}%)`,
            data: results.planC.yearlyData.map(d => d.netBalance),
            borderColor: '#10b981',
            borderWidth: 2.5,
            tension: 0.2,
            pointRadius: 2
          }
        ]
      };
    }

    mainChartInstance.update();
  }
};

// ============================================================================
// UI Updates & Syncing
// ============================================================================
function updateSimulator() {
  let res;
  switch (state.activeTab) {
    case 'accumulate':
      res = CalcEngine.calculateAccumulate(state.accumulate);
      updateKPIsAccumulate(res);
      updateInsightAccumulate(res);
      updateTable(res);
      break;
    case 'goal':
      res = CalcEngine.calculateGoal(state.goal);
      updateKPIsGoal(res);
      updateInsightGoal(res);
      updateTable(res);
      break;
    case 'fire':
      res = CalcEngine.calculateFire(state.fire);
      updateKPIsFire(res);
      updateInsightFire(res);
      updateTableFire(res);
      break;
    case 'lifeplan':
      res = CalcEngine.calculateLifePlan(state.lifeplan);
      updateKPIsLifePlan(res);
      updateInsightLifePlan(res);
      updateTable(res);
      break;
    case 'compare':
      res = CalcEngine.calculateCompare(state.compare);
      updateKPIsCompare(res);
      updateInsightCompare(res);
      updateTableCompare(res);
      break;
  }

  state.results = res;
  ChartManager.updateCharts(res);
  saveStateToLocalStorage();
}

function updateKPIsAccumulate(res) {
  document.getElementById('kpi-main-label').innerText = `最終積立総額 (${state.accumulate.years}年後)`;
  animateNumber('kpi-total-val', res.summary.totalBalance);
  document.getElementById('kpi-total-sub').innerText = `（約 ${(res.summary.totalBalance / 10000).toFixed(2)} 億円）`;

  document.getElementById('kpi-principal-label').innerText = '投資元本累計';
  animateNumber('kpi-principal-val', res.summary.totalInvested);
  const principalPct = res.summary.totalBalance > 0 ? (res.summary.totalInvested / res.summary.totalBalance * 100).toFixed(1) : 0;
  document.getElementById('kpi-principal-pct').innerText = `元本割合 ${principalPct}%`;

  document.getElementById('kpi-profit-label').innerText = '運用収益 (リターン)';
  animateNumber('kpi-profit-val', res.summary.totalProfit, true);
  document.getElementById('kpi-profit-pct').innerText = `+${res.summary.profitPercent.toFixed(1)}%`;

  // Aux card
  document.getElementById('kpi-aux-label').innerText = '新NISA節税効果';
  animateNumber('kpi-aux-val', res.summary.taxSaved);
  document.getElementById('kpi-aux-unit').innerText = '万円';
  document.getElementById('kpi-aux-sub').innerText = '20.315%非課税メリット';
}

function updateKPIsGoal(res) {
  document.getElementById('kpi-main-label').innerText = `毎月の必要積立額`;
  animateNumber('kpi-total-val', res.summary.requiredMonthly);
  document.getElementById('kpi-total-sub').innerText = `目標 ${formatMoneyJapanese(res.target)} 達成用`;

  document.getElementById('kpi-principal-label').innerText = '投資元本累計';
  animateNumber('kpi-principal-val', res.summary.totalInvested);
  document.getElementById('kpi-principal-pct').innerText = `期間: ${res.summary.yearsToTarget}年間`;

  document.getElementById('kpi-profit-label').innerText = '達成時 運用収益';
  animateNumber('kpi-profit-val', res.summary.totalProfit, true);
  document.getElementById('kpi-profit-pct').innerText = `+${res.summary.profitPercent.toFixed(1)}%`;

  document.getElementById('kpi-aux-label').innerText = '目標資産到達額';
  animateNumber('kpi-aux-val', res.summary.totalBalance);
  document.getElementById('kpi-aux-unit').innerText = '万円';
  document.getElementById('kpi-aux-sub').innerText = '年利 ' + state.goal.rate + '% 運用';
}

function updateKPIsFire(res) {
  document.getElementById('kpi-main-label').innerText = res.summary.isSustained ? 'シミュレーション終了時残高' : '資産枯渇年齢';
  if (res.summary.isSustained) {
    animateNumber('kpi-total-val', res.summary.remainingBalance);
    document.getElementById('kpi-total-sub').innerText = `資産維持成功 (${state.fire.years}年後)`;
  } else {
    document.getElementById('kpi-total-val').innerText = `${res.summary.depletedAge}歳`;
    document.getElementById('kpi-total-sub').innerText = `開始から ${res.depletedYear} 年後に枯渇`;
  }

  document.getElementById('kpi-principal-label').innerText = '開始時資産額';
  animateNumber('kpi-principal-val', res.summary.initialAssets);
  document.getElementById('kpi-principal-pct').innerText = `${state.fire.startAge}歳時点`;

  document.getElementById('kpi-profit-label').innerText = '累計取り崩し額';
  animateNumber('kpi-profit-val', res.summary.totalWithdrawn);
  document.getElementById('kpi-profit-pct').innerText = `手元に引き出した総額`;

  document.getElementById('kpi-aux-label').innerText = '運用利回り';
  document.getElementById('kpi-aux-val').innerText = `${state.fire.returnRate}`;
  document.getElementById('kpi-aux-unit').innerText = '%';
  document.getElementById('kpi-aux-sub').innerText = 'リタイア後の低リスク運用';
}

function updateKPIsLifePlan(res) {
  document.getElementById('kpi-main-label').innerText = `最終資産残高 (${state.lifeplan.years}年後)`;
  animateNumber('kpi-total-val', res.summary.totalBalance);
  document.getElementById('kpi-total-sub').innerText = `（約 ${(res.summary.totalBalance / 10000).toFixed(2)} 億円）`;

  document.getElementById('kpi-principal-label').innerText = '投資元本累計';
  animateNumber('kpi-principal-val', res.summary.totalInvested);
  document.getElementById('kpi-principal-pct').innerText = `積立 + 初期資産`;

  document.getElementById('kpi-profit-label').innerText = '運用収益';
  animateNumber('kpi-profit-val', res.summary.totalProfit, true);
  document.getElementById('kpi-profit-pct').innerText = `+${res.summary.profitPercent.toFixed(1)}%`;

  document.getElementById('kpi-aux-label').innerText = '登録イベント数';
  document.getElementById('kpi-aux-val').innerText = `${res.summary.eventCount}`;
  document.getElementById('kpi-aux-unit').innerText = '件';
  document.getElementById('kpi-aux-sub').innerText = '人生の支出・収入を反映';
}

function updateKPIsCompare(res) {
  const finalA = res.planA.summary.totalBalance;
  const finalB = res.planB.summary.totalBalance;
  const finalC = res.planC.summary.totalBalance;

  document.getElementById('kpi-main-label').innerText = `プランB (標準) 最終額`;
  animateNumber('kpi-total-val', finalB);
  document.getElementById('kpi-total-sub').innerText = `${res.years}年後の資産`;

  document.getElementById('kpi-principal-label').innerText = 'プランA (堅実)';
  animateNumber('kpi-principal-val', finalA);
  document.getElementById('kpi-principal-pct').innerText = `月${state.compare.planA.monthly}万 / ${state.compare.planA.rate}%`;

  document.getElementById('kpi-profit-label').innerText = 'プランC (積極)';
  animateNumber('kpi-profit-val', finalC);
  document.getElementById('kpi-profit-pct').innerText = `月${state.compare.planC.monthly}万 / ${state.compare.planC.rate}%`;

  document.getElementById('kpi-aux-label').innerText = '最大差額 (C vs A)';
  animateNumber('kpi-aux-val', Math.round(finalC - finalA));
  document.getElementById('kpi-aux-unit').innerText = '万円';
  document.getElementById('kpi-aux-sub').innerText = '積立額と利回りの差';
}

// Insights Texts
function updateInsightAccumulate(res) {
  const years = state.accumulate.years;
  const profit = res.summary.totalProfit;
  const banner = document.getElementById('insight-text');
  banner.innerHTML = `<strong>${years}年間</strong>の複利効果により、投資元本に対して<strong>+${formatMoneyJapanese(profit)}</strong>の運用収益が生まれました。新NISA活用で約<strong>${formatMoneyJapanese(res.summary.taxSaved)}</strong>の税金が免除されます。`;
}

function updateInsightGoal(res) {
  const target = res.target;
  const years = state.goal.years;
  const monthly = res.summary.requiredMonthly;
  const banner = document.getElementById('insight-text');
  banner.innerHTML = `<strong>${years}年後</strong>に<strong>${formatMoneyJapanese(target)}</strong>を達成するには、年利${state.goal.rate}%で毎月<strong>${monthly}万円</strong>の積立が必要です。`;
}

function updateInsightFire(res) {
  const banner = document.getElementById('insight-text');
  if (res.summary.isSustained) {
    banner.innerHTML = `年間取り崩しと年利${state.fire.returnRate}%の運用バランスが取れており、<strong>${state.fire.years}年後</strong>も資産が枯渇せず<strong>${formatMoneyJapanese(res.summary.remainingBalance)}</strong>残ります。`;
  } else {
    banner.innerHTML = `現在の取り崩しペースでは、<strong>${res.summary.depletedAge}歳 (開始から${res.depletedYear}年後)</strong>に資産が枯渇します。月々の支出を見直すか運用利回りの改善が推奨されます。`;
  }
}

function updateInsightLifePlan(res) {
  const banner = document.getElementById('insight-text');
  banner.innerHTML = `設定された<strong>${state.lifeplan.events.length}件</strong>のライフイベント支出を吸収しながら、${state.lifeplan.years}年後には<strong>${formatMoneyJapanese(res.summary.totalBalance)}</strong>の資産形成が可能です。`;
}

function updateInsightCompare(res) {
  const banner = document.getElementById('insight-text');
  banner.innerHTML = `毎月の積立額と利回りの差により、${state.compare.years}年後にはプランAとプランCで<strong>${formatMoneyJapanese(res.planC.summary.totalBalance - res.planA.summary.totalBalance)}</strong>の資産格差が生じます。`;
}

// Table Rendering
function updateTable(res) {
  const thead = document.querySelector('#simulation-table thead tr');
  thead.innerHTML = `
    <th>経過年</th>
    <th>年齢</th>
    <th>投資累計額(元本)</th>
    <th>年間利息</th>
    <th>運用収益累計</th>
    <th>資産残高(税引前)</th>
    <th>新NISA非課税枠残高</th>
    <th>手取り資産残高</th>
  `;

  const tbody = document.getElementById('simulation-table-body');
  tbody.innerHTML = res.yearlyData.map(row => `
    <tr>
      <td>${row.year}年目</td>
      <td>${row.age}歳</td>
      <td>${formatMoneyJapanese(row.invested)}</td>
      <td>${formatMoneyJapanese(row.interestThisYear)}</td>
      <td class="text-profit">+${formatMoneyJapanese(row.profit)}</td>
      <td>${formatMoneyJapanese(row.balance)}</td>
      <td>${formatMoneyJapanese(row.nisaBalance)}</td>
      <td><strong>${formatMoneyJapanese(row.netBalance !== undefined ? row.netBalance : row.balance)}</strong></td>
    </tr>
  `).join('');
}

function updateTableFire(res) {
  const thead = document.querySelector('#simulation-table thead tr');
  thead.innerHTML = `
    <th>経過年</th>
    <th>年齢</th>
    <th>年間取り崩し額</th>
    <th>年間運用利息</th>
    <th>累計取崩額</th>
    <th>期末資産残高</th>
  `;

  const tbody = document.getElementById('simulation-table-body');
  tbody.innerHTML = res.yearlyData.map(row => `
    <tr>
      <td>${row.year}年目</td>
      <td>${row.age}歳</td>
      <td class="amount-expense">-${formatMoneyJapanese(row.annualWithdrawal)}</td>
      <td class="text-profit">+${formatMoneyJapanese(row.annualInterest)}</td>
      <td>${formatMoneyJapanese(row.totalWithdrawn)}</td>
      <td><strong>${formatMoneyJapanese(row.balance)}</strong></td>
    </tr>
  `).join('');
}

function updateTableCompare(res) {
  const thead = document.querySelector('#simulation-table thead tr');
  thead.innerHTML = `
    <th>経過年</th>
    <th>プランA (堅実)</th>
    <th>プランB (標準)</th>
    <th>プランC (積極)</th>
    <th>差額 (C - A)</th>
  `;

  const tbody = document.getElementById('simulation-table-body');
  const rows = [];
  const len = res.planA.yearlyData.length;
  for (let i = 0; i < len; i++) {
    const rA = res.planA.yearlyData[i];
    const rB = res.planB.yearlyData[i];
    const rC = res.planC.yearlyData[i];
    rows.push(`
      <tr>
        <td>${rA.year}年後</td>
        <td>${formatMoneyJapanese(rA.netBalance)}</td>
        <td>${formatMoneyJapanese(rB.netBalance)}</td>
        <td class="text-profit">${formatMoneyJapanese(rC.netBalance)}</td>
        <td><strong>+${formatMoneyJapanese(rC.netBalance - rA.netBalance)}</strong></td>
      </tr>
    `);
  }
  tbody.innerHTML = rows.join('');
}

// ============================================================================
// Helpers & Utilities
// ============================================================================
function formatMoneyJapanese(val) {
  if (val === undefined || val === null) return '0万円';
  const num = Math.round(val * 10) / 10;
  if (Math.abs(num) >= 10000) {
    const oku = (num / 10000).toFixed(2);
    return `${oku}億円 (${num.toLocaleString()}万円)`;
  }
  return `${num.toLocaleString()}万円`;
}

function animateNumber(elementId, targetVal, isPositiveSign = false) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const num = Math.round(targetVal * 10) / 10;
  el.innerText = (isPositiveSign && num > 0 ? '+' : '') + num.toLocaleString();
}

function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  toastMsg.innerText = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2500);
}

// ============================================================================
// Input Binding & Event Listeners
// ============================================================================
function setupInputBindings() {
  // Synchronize Range Slider & Number Input
  function bindSliderAndNumber(sliderId, numberId, valSpanId, statePath, updateCallback) {
    const slider = document.getElementById(sliderId);
    const numInput = document.getElementById(numberId);
    const span = document.getElementById(valSpanId);

    if (!slider || !numInput) return;

    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      numInput.value = val;
      if (span) span.innerText = val;
      setNestedProperty(state, statePath, val);
      if (updateCallback) updateCallback();
      updateSimulator();
    });

    numInput.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) || 0;
      slider.value = val;
      if (span) span.innerText = val;
      setNestedProperty(state, statePath, val);
      if (updateCallback) updateCallback();
      updateSimulator();
    });
  }

  function setNestedProperty(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }

  // Bind Tab 1 (Accumulate)
  bindSliderAndNumber('acc-initial', 'acc-initial-num', 'acc-initial-val', 'accumulate.initial');
  bindSliderAndNumber('acc-monthly', 'acc-monthly-num', 'acc-monthly-val', 'accumulate.monthly');
  bindSliderAndNumber('acc-rate', 'acc-rate-num', 'acc-rate-val', 'accumulate.rate');
  bindSliderAndNumber('acc-years', 'acc-years-num', 'acc-years-val', 'accumulate.years');
  bindSliderAndNumber('acc-start-age', 'acc-start-age-num', 'acc-start-age-val', 'accumulate.startAge');
  bindSliderAndNumber('acc-inflation', 'acc-inflation-num', 'acc-inflation-val', 'accumulate.inflation');

  const nisaToggle = document.getElementById('acc-nisa-enabled');
  if (nisaToggle) {
    nisaToggle.addEventListener('change', (e) => {
      state.accumulate.nisaEnabled = e.target.checked;
      updateSimulator();
    });
  }

  // Accordion for advanced settings
  const btnAccAdvanced = document.getElementById('btn-acc-advanced');
  const accAdvancedBody = document.getElementById('acc-advanced-body');
  if (btnAccAdvanced && accAdvancedBody) {
    btnAccAdvanced.addEventListener('click', () => {
      btnAccAdvanced.classList.toggle('open');
      accAdvancedBody.classList.toggle('hidden');
    });
  }

  // Bind Tab 2 (Goal)
  bindSliderAndNumber('goal-target', 'goal-target-num', 'goal-target-val', 'goal.target');
  bindSliderAndNumber('goal-years', 'goal-years-num', 'goal-years-val', 'goal.years');
  bindSliderAndNumber('goal-initial', 'goal-initial-num', 'goal-initial-val', 'goal.initial');
  bindSliderAndNumber('goal-rate', 'goal-rate-num', 'goal-rate-val', 'goal.rate');

  // Bind Tab 3 (FIRE)
  bindSliderAndNumber('fire-assets', 'fire-assets-num', 'fire-assets-val', 'fire.assets');
  bindSliderAndNumber('fire-monthly', 'fire-monthly-num', 'fire-monthly-val', 'fire.monthly');
  bindSliderAndNumber('fire-rate-pct', 'fire-rate-pct-num', 'fire-rate-pct-val', 'fire.ratePct');
  bindSliderAndNumber('fire-return-rate', 'fire-return-rate-num', 'fire-return-rate-val', 'fire.returnRate');
  bindSliderAndNumber('fire-start-age', 'fire-start-age-num', 'fire-start-age-val', 'fire.startAge');
  bindSliderAndNumber('fire-years', 'fire-years-num', 'fire-years-val', 'fire.years');

  // FIRE Type Radios
  document.querySelectorAll('input[name="fire-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.fire.type = e.target.value;
      const fixedGroup = document.getElementById('fire-fixed-amount-group');
      const rateGroup = document.getElementById('fire-fixed-rate-group');
      if (e.target.value === 'fixed-amount') {
        fixedGroup.classList.remove('hidden');
        rateGroup.classList.add('hidden');
      } else {
        fixedGroup.classList.add('hidden');
        rateGroup.classList.remove('hidden');
      }
      updateSimulator();
    });
  });

  // Bind Tab 4 (Life Plan)
  bindSliderAndNumber('lp-initial', 'lp-initial-num', 'lp-initial-val', 'lifeplan.initial');
  bindSliderAndNumber('lp-monthly', 'lp-monthly-num', 'lp-monthly-val', 'lifeplan.monthly');
  bindSliderAndNumber('lp-rate', 'lp-rate-num', 'lp-rate-val', 'lifeplan.rate');
  bindSliderAndNumber('lp-years', 'lp-years-num', 'lp-years-val', 'lifeplan.years');

  // Bind Tab 5 (Compare)
  ['cmp-monthly-a', 'cmp-rate-a', 'cmp-monthly-b', 'cmp-rate-b', 'cmp-monthly-c', 'cmp-rate-c'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        state.compare.planA.monthly = parseFloat(document.getElementById('cmp-monthly-a').value) || 0;
        state.compare.planA.rate = parseFloat(document.getElementById('cmp-rate-a').value) || 0;
        state.compare.planB.monthly = parseFloat(document.getElementById('cmp-monthly-b').value) || 0;
        state.compare.planB.rate = parseFloat(document.getElementById('cmp-rate-b').value) || 0;
        state.compare.planC.monthly = parseFloat(document.getElementById('cmp-monthly-c').value) || 0;
        state.compare.planC.rate = parseFloat(document.getElementById('cmp-rate-c').value) || 0;
        updateSimulator();
      });
    }
  });

  bindSliderAndNumber('cmp-years', 'cmp-years-num', 'cmp-years-val', 'compare.years');
  bindSliderAndNumber('cmp-initial', 'cmp-initial-num', 'cmp-initial-val', 'compare.initial');

  // Tab Switching
  document.querySelectorAll('.nav-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      tabBtn.classList.add('active');
      tabBtn.setAttribute('aria-selected', 'true');
      const tabKey = tabBtn.getAttribute('data-tab');
      state.activeTab = tabKey;

      const targetContent = document.getElementById(`tab-${tabKey}`);
      if (targetContent) targetContent.classList.add('active');

      const presetsContainer = document.getElementById('presets-container');
      if (tabKey === 'accumulate') {
        presetsContainer.classList.remove('hidden');
      } else {
        presetsContainer.classList.add('hidden');
      }

      updateSimulator();
    });
  });

  // Presets
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const presetKey = chip.getAttribute('data-preset');
      const p = PRESETS[presetKey];
      if (!p) return;

      state.accumulate.initial = p.initial;
      state.accumulate.monthly = p.monthly;
      state.accumulate.rate = p.rate;
      state.accumulate.years = p.years;
      state.accumulate.startAge = p.startAge;
      state.accumulate.nisaEnabled = p.nisaEnabled;

      // Sync form DOM
      syncInputsFromState('acc-initial', p.initial);
      syncInputsFromState('acc-monthly', p.monthly);
      syncInputsFromState('acc-rate', p.rate);
      syncInputsFromState('acc-years', p.years);
      syncInputsFromState('acc-start-age', p.startAge);
      if (nisaToggle) nisaToggle.checked = p.nisaEnabled;

      showToast(`プリセット「${chip.innerText}」を適用しました`);
      updateSimulator();
    });
  });

  // Chart Type Toggles
  document.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chartType = btn.getAttribute('data-chart-type');
      ChartManager.updateCharts(state.results);
    });
  });

  // Table Visibility Toggle
  const btnToggleTable = document.getElementById('btn-toggle-table');
  const tableContainer = document.getElementById('table-container');
  const toggleTableText = document.getElementById('toggle-table-text');
  const toggleTableIcon = document.getElementById('toggle-table-icon');

  if (btnToggleTable && tableContainer) {
    btnToggleTable.addEventListener('click', () => {
      state.tableVisible = !state.tableVisible;
      if (state.tableVisible) {
        tableContainer.classList.remove('hidden');
        toggleTableText.innerText = '表を隠す';
        toggleTableIcon.style.transform = 'rotate(180deg)';
      } else {
        tableContainer.classList.add('hidden');
        toggleTableText.innerText = '表を表示する';
        toggleTableIcon.style.transform = 'rotate(0deg)';
      }
    });
  }

  // Theme Toggle
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const themeIconLight = document.getElementById('theme-icon-light');
  const themeIconDark = document.getElementById('theme-icon-dark');

  function applyTheme(th) {
    state.theme = th;
    document.documentElement.setAttribute('data-theme', th);
    localStorage.setItem('wealth_sim_theme', th);
    if (th === 'light') {
      themeIconLight.classList.remove('hidden');
      themeIconDark.classList.add('hidden');
    } else {
      themeIconLight.classList.add('hidden');
      themeIconDark.classList.remove('hidden');
    }
    if (state.results) {
      ChartManager.updateCharts(state.results);
    }
  }

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });
  }
  applyTheme(state.theme);

  // CSV Export
  const btnExportCsv = document.getElementById('btn-export-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', exportCSV);
  }

  // Reset Button
  const btnReset = document.getElementById('btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (confirm('シミュレーション設定を初期化しますか？')) {
        localStorage.removeItem('wealth_sim_state');
        location.reload();
      }
    });
  }

  // Life Event Management
  setupLifeEventHandlers();
}

function syncInputsFromState(baseId, val) {
  const slider = document.getElementById(baseId);
  const numInput = document.getElementById(`${baseId}-num`);
  const span = document.getElementById(`${baseId}-val`);
  if (slider) slider.value = val;
  if (numInput) numInput.value = val;
  if (span) span.innerText = val;
}

// ============================================================================
// Life Events Modal & Management
// ============================================================================
function setupLifeEventHandlers() {
  const eventModal = document.getElementById('event-modal');
  const btnAddEvent = document.getElementById('btn-add-event');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCancelModal = document.getElementById('btn-cancel-modal');
  const btnSaveEvent = document.getElementById('btn-save-event');
  const eventPresetDropdown = document.getElementById('event-preset-dropdown');

  renderEventsList();

  if (btnAddEvent) {
    btnAddEvent.addEventListener('click', () => {
      document.getElementById('event-name').value = 'マイホーム購入';
      document.getElementById('event-year').value = 5;
      document.getElementById('event-amount').value = -500;
      eventModal.classList.remove('hidden');
    });
  }

  const closeModal = () => eventModal.classList.add('hidden');
  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
  if (btnCancelModal) btnCancelModal.addEventListener('click', closeModal);

  if (eventPresetDropdown) {
    eventPresetDropdown.addEventListener('change', (e) => {
      const selected = e.target.options[e.target.selectedIndex];
      if (selected.value) {
        document.getElementById('event-name').value = selected.text.split(' (')[0];
        document.getElementById('event-amount').value = selected.getAttribute('data-amount');
        document.getElementById('event-year').value = selected.getAttribute('data-year');
      }
    });
  }

  if (btnSaveEvent) {
    btnSaveEvent.addEventListener('click', () => {
      const name = document.getElementById('event-name').value.trim() || '無題のイベント';
      const year = parseInt(document.getElementById('event-year').value, 10) || 1;
      const amount = parseFloat(document.getElementById('event-amount').value) || 0;

      state.lifeplan.events.push({
        id: 'evt-' + Date.now(),
        name,
        year,
        amount
      });

      renderEventsList();
      closeModal();
      showToast('イベントを追加しました');
      if (state.activeTab === 'lifeplan') updateSimulator();
    });
  }
}

function renderEventsList() {
  const container = document.getElementById('events-list-container');
  if (!container) return;

  state.lifeplan.events.sort((a, b) => a.year - b.year);

  container.innerHTML = state.lifeplan.events.map(evt => `
    <div class="event-item" data-id="${evt.id}">
      <div class="event-item-info">
        <span class="event-item-name">${evt.name}</span>
        <span class="event-item-timing">${evt.year}年後 (年齢: 約${30 + evt.year}歳)</span>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span class="event-item-amount ${evt.amount < 0 ? 'amount-expense' : 'amount-income'}">
          ${evt.amount > 0 ? '+' : ''}${evt.amount.toLocaleString()} 万円
        </span>
        <button type="button" class="btn-delete-event" title="削除" onclick="deleteLifeEvent('${evt.id}')">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

window.deleteLifeEvent = function(id) {
  state.lifeplan.events = state.lifeplan.events.filter(e => e.id !== id);
  renderEventsList();
  showToast('イベントを削除しました');
  if (state.activeTab === 'lifeplan') updateSimulator();
};

// ============================================================================
// CSV Export Functionality (Excel UTF-8 BOM)
// ============================================================================
function exportCSV() {
  if (!state.results || !state.results.yearlyData) return;

  let csvContent = '\uFEFF'; // UTF-8 BOM for Japanese Excel compatibility
  let headers = [];
  let rows = [];

  if (state.results.type === 'accumulate' || state.results.type === 'goal' || state.results.type === 'lifeplan') {
    headers = ['経過年(年後)', '年齢(歳)', '投資元本累計(万円)', '年間運用益(万円)', '累計運用益(万円)', '税引前資産残高(万円)', '新NISA非課税枠残高(万円)', '手取り資産残高(万円)'];
    rows = state.results.yearlyData.map(d => [
      d.year,
      d.age,
      d.invested,
      d.interestThisYear || 0,
      d.profit,
      d.balance,
      d.nisaBalance || 0,
      d.netBalance !== undefined ? d.netBalance : d.balance
    ]);
  } else if (state.results.type === 'fire') {
    headers = ['経過年(年目)', '年齢(歳)', '年間取崩額(万円)', '年間運用利息(万円)', '累計取崩額(万円)', '期末資産残高(万円)'];
    rows = state.results.yearlyData.map(d => [
      d.year,
      d.age,
      d.annualWithdrawal,
      d.annualInterest,
      d.totalWithdrawn,
      d.balance
    ]);
  } else if (state.results.type === 'compare') {
    headers = ['経過年', 'プランA(万円)', 'プランB(万円)', 'プランC(万円)', '差額(C-A)(万円)'];
    rows = state.results.planA.yearlyData.map((d, i) => [
      `${d.year}年後`,
      d.netBalance,
      state.results.planB.yearlyData[i].netBalance,
      state.results.planC.yearlyData[i].netBalance,
      state.results.planC.yearlyData[i].netBalance - d.netBalance
    ]);
  }

  csvContent += headers.join(',') + '\n';
  rows.forEach(r => {
    csvContent += r.join(',') + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `資産形成シミュレーション_${state.activeTab}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('CSVファイルをダウンロードしました');
}

// ============================================================================
// State Persistence (LocalStorage)
// ============================================================================
function saveStateToLocalStorage() {
  try {
    const toSave = {
      accumulate: state.accumulate,
      goal: state.goal,
      fire: state.fire,
      lifeplan: state.lifeplan,
      compare: state.compare
    };
    localStorage.setItem('wealth_sim_state', JSON.stringify(toSave));
  } catch (e) {
    console.warn('LocalStorage save failed:', e);
  }
}

function loadStateFromLocalStorage() {
  try {
    const saved = localStorage.getItem('wealth_sim_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.accumulate) Object.assign(state.accumulate, parsed.accumulate);
      if (parsed.goal) Object.assign(state.goal, parsed.goal);
      if (parsed.fire) Object.assign(state.fire, parsed.fire);
      if (parsed.lifeplan) Object.assign(state.lifeplan, parsed.lifeplan);
      if (parsed.compare) Object.assign(state.compare, parsed.compare);

      // Sync form DOM with loaded state
      syncInputsFromState('acc-initial', state.accumulate.initial);
      syncInputsFromState('acc-monthly', state.accumulate.monthly);
      syncInputsFromState('acc-rate', state.accumulate.rate);
      syncInputsFromState('acc-years', state.accumulate.years);
      syncInputsFromState('acc-start-age', state.accumulate.startAge);
      syncInputsFromState('acc-inflation', state.accumulate.inflation);
      const nisaToggle = document.getElementById('acc-nisa-enabled');
      if (nisaToggle) nisaToggle.checked = state.accumulate.nisaEnabled;

      syncInputsFromState('goal-target', state.goal.target);
      syncInputsFromState('goal-years', state.goal.years);
      syncInputsFromState('goal-initial', state.goal.initial);
      syncInputsFromState('goal-rate', state.goal.rate);

      syncInputsFromState('fire-assets', state.fire.assets);
      syncInputsFromState('fire-monthly', state.fire.monthly);
      syncInputsFromState('fire-rate-pct', state.fire.ratePct);
      syncInputsFromState('fire-return-rate', state.fire.returnRate);
      syncInputsFromState('fire-start-age', state.fire.startAge);
      syncInputsFromState('fire-years', state.fire.years);

      syncInputsFromState('lp-initial', state.lifeplan.initial);
      syncInputsFromState('lp-monthly', state.lifeplan.monthly);
      syncInputsFromState('lp-rate', state.lifeplan.rate);
      syncInputsFromState('lp-years', state.lifeplan.years);

      syncInputsFromState('cmp-years', state.compare.years);
      syncInputsFromState('cmp-initial', state.compare.initial);
    }
  } catch (e) {
    console.warn('LocalStorage load failed:', e);
  }
}

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  loadStateFromLocalStorage();
  setupInputBindings();
  ChartManager.initCharts();
  updateSimulator();
});
