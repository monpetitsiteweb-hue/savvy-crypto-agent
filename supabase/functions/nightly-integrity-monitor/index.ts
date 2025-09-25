// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false }
    })

    console.log('🔍 Starting nightly integrity monitor...')

    // Check 1: Count corrupted trades
    const { data: corruptedTrades, error: corruptedError } = await supabase
      .from('mock_trades')
      .select('id, cryptocurrency, integrity_reason, created_at')
      .eq('is_corrupted', true)

    if (corruptedError) throw corruptedError

    // Check 2: Count blocked by lock decisions (last 24h)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: blockedDecisions, error: blockedError } = await supabase
      .from('trade_decisions_log')
      .select('id, decision_reason, created_at')
      .ilike('decision_reason', '%blocked_by_lock%')
      .gte('created_at', yesterday)

    if (blockedError) throw blockedError

    // Check 3: Count non-200 coordinator responses (last 24h)
    // Note: In production, this would query actual HTTP logs
    // For demo, we'll simulate based on decision logs with error patterns
    const { data: errorDecisions, error: errorDecisionsError } = await supabase
      .from('trade_decisions_log')
      .select('id, decision_reason, metadata, created_at')
      .ilike('decision_reason', '%error%')
      .gte('created_at', yesterday)

    if (errorDecisionsError) throw errorDecisionsError

    // Check 4: Identify trades with formula mismatches
    const { data: allTrades, error: tradesError } = await supabase
      .from('mock_trades')
      .select('id, amount, price, total_value, cryptocurrency, is_corrupted')
      .eq('trade_type', 'buy')
      .eq('is_corrupted', false)
      .gte('created_at', yesterday)

    if (tradesError) throw tradesError

    // Validate formulas for recent trades
    const formulaMismatches: any[] = []
    const epsilon = 0.01

    allTrades?.forEach(trade => {
      const expectedValue = trade.amount * trade.price
      const variance = Math.abs(trade.total_value - expectedValue)
      
      if (variance > epsilon) {
        formulaMismatches.push({
          trade_id: trade.id,
          symbol: trade.cryptocurrency,
          expected: expectedValue,
          actual: trade.total_value,
          variance
        })
      }
    })

    // Generate report
    const report = {
      report_date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      checks: {
        corrupted_trades: {
          count: corruptedTrades?.length || 0,
          details: corruptedTrades?.slice(0, 5).map(t => ({
            id: t.id,
            symbol: t.cryptocurrency,
            reason: t.integrity_reason,
            created: t.created_at
          })) || []
        },
        blocked_by_lock: {
          count: blockedDecisions?.length || 0,
          last_24h: blockedDecisions?.length || 0
        },
        coordinator_errors: {
          count: errorDecisions?.length || 0,
          last_24h: errorDecisions?.length || 0
        },
        formula_mismatches: {
          count: formulaMismatches.length,
          details: formulaMismatches.slice(0, 3)
        }
      },
      health_status: {
        overall: 'HEALTHY', // Will be calculated
        critical_issues: 0,
        warnings: 0
      }
    }

    // Calculate health status
    let criticalIssues = 0
    let warnings = 0

    if (report.checks.corrupted_trades.count > 0) criticalIssues++
    if (report.checks.formula_mismatches.count > 0) criticalIssues++
    if (report.checks.blocked_by_lock.count > 10) warnings++ // >10 blocks might indicate contention
    if (report.checks.coordinator_errors.count > 0) criticalIssues++

    report.health_status.critical_issues = criticalIssues
    report.health_status.warnings = warnings
    report.health_status.overall = criticalIssues > 0 ? 'CRITICAL' : warnings > 0 ? 'WARNING' : 'HEALTHY'

    // Log findings
    console.log('📊 NIGHTLY INTEGRITY REPORT:', JSON.stringify(report, null, 2))

    // In production, this would:
    // 1. Store report in monitoring table
    // 2. Send alerts for critical issues
    // 3. Generate dashboard metrics

    const responseText = `
🔍 NIGHTLY INTEGRITY REPORT - ${report.report_date}
=============================================================
✅ Corrupted Trades: ${report.checks.corrupted_trades.count}
${report.checks.corrupted_trades.count > 0 ? 
  `   └─ Reasons: ${report.checks.corrupted_trades.details.map(d => d.reason).join(', ')}` : ''}

✅ Blocked by Lock (24h): ${report.checks.blocked_by_lock.count}
${report.checks.blocked_by_lock.count > 10 ? '   ⚠️  High contention detected' : ''}

✅ Coordinator Errors (24h): ${report.checks.coordinator_errors.count}
${report.checks.coordinator_errors.count > 0 ? '   🚨 Non-200 responses detected' : ''}

✅ Formula Mismatches: ${report.checks.formula_mismatches.count}
${report.checks.formula_mismatches.count > 0 ? 
  `   └─ Largest variance: €${Math.max(...formulaMismatches.map(f => f.variance)).toFixed(2)}` : ''}

🎯 HEALTH STATUS: ${report.health_status.overall}
   Critical Issues: ${report.health_status.critical_issues}
   Warnings: ${report.health_status.warnings}

${report.health_status.overall === 'HEALTHY' ? '🛡️ All regression guards passed - system integrity maintained' : 
  '🚨 REGRESSION DETECTED - Review issues above'}
    `.trim()

    return new Response(JSON.stringify({
      success: true,
      report,
      summary: responseText
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    })

  } catch (error) {
    console.error('❌ Nightly monitor error:', error)
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})