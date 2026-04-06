import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Archive, AlertTriangle, CheckCircle, XCircle, RefreshCw, 
  Database, FileText, Trash2, Download, Loader2 
} from 'lucide-react';

interface ArchiveLogRow {
  id: string;
  run_id: string;
  archive_date: string;
  file_path: string;
  cutoff_timestamp: string;
  row_count_exported: number;
  row_count_deleted: number;
  prune_status: string;
  error_message: string | null;
  per_symbol_counts: Record<string, number> | null;
  earliest_timestamp: string | null;
  latest_timestamp: string | null;
  file_checksum: string | null;
  created_at: string;
}

interface StorageFile {
  name: string;
  folder: string;
  size: number;
  etag: string;
  created_at: string;
  isDuplicate: boolean;
}

interface PriceDataStats {
  symbol: string;
  total_rows: number;
  oldest: string;
  newest: string;
}

export function ArchiveHealthPanel() {
  const [logs, setLogs] = useState<ArchiveLogRow[]>([]);
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [priceStats, setPriceStats] = useState<PriceDataStats[]>([]);
  const [dataProfile, setDataProfile] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [integrityRan, setIntegrityRan] = useState(false);

  useEffect(() => {
    loadArchiveLogs();
    loadStorageFiles();
  }, []);

  async function loadArchiveLogs() {
    const { data } = await (supabase as any)
      .from('price_data_archive_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(15);
    if (data) setLogs(data);
  }

  async function loadStorageFiles() {
    // List all date folders
    const { data: folders } = await supabase.storage
      .from('price-data-archives')
      .list('', { limit: 100 });

    if (!folders) return;

    const allFiles: StorageFile[] = [];
    const etagMap = new Map<string, number>();

    for (const folder of folders) {
      if (folder.id) continue; // skip if it's a file at root level
      const { data: filesInFolder } = await supabase.storage
        .from('price-data-archives')
        .list(folder.name, { limit: 100 });

      if (filesInFolder) {
        for (const f of filesInFolder) {
          const etag = (f.metadata as any)?.eTag || '';
          const count = etagMap.get(etag) || 0;
          etagMap.set(etag, count + 1);
          allFiles.push({
            name: f.name,
            folder: folder.name,
            size: (f.metadata as any)?.size || 0,
            etag,
            created_at: f.created_at,
            isDuplicate: false,
          });
        }
      }
    }

    // Mark duplicates
    for (const f of allFiles) {
      if (etagMap.get(f.etag)! > 1) f.isDuplicate = true;
    }

    setFiles(allFiles);
  }

  async function runIntegrityChecks() {
    setIntegrityLoading(true);
    try {
      // Query 1: rows older than 30 days
      const { data: stats } = await (supabase as any).rpc('exec_sql_readonly', {
        sql: `SELECT symbol, COUNT(*) as total_rows, MIN(timestamp)::text as oldest, MAX(timestamp)::text as newest FROM price_data WHERE timestamp < NOW() - INTERVAL '30 days' GROUP BY symbol ORDER BY symbol;`
      });

      // Fallback: use direct query per symbol
      const symbolStats: PriceDataStats[] = [];
      const symbols = ['ADA-EUR', 'AVAX-EUR', 'BCH-EUR', 'BTC-EUR', 'DOT-EUR', 'ETH-EUR', 'LINK-EUR', 'LTC-EUR', 'SOL-EUR', 'XRP-EUR'];

      for (const sym of symbols) {
        const { count } = await (supabase as any)
          .from('price_data')
          .select('*', { count: 'exact', head: true })
          .eq('symbol', sym)
          .lt('timestamp', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

        if (count && count > 0) {
          // Get min/max timestamps
          const { data: oldest } = await (supabase as any)
            .from('price_data')
            .select('timestamp')
            .eq('symbol', sym)
            .lt('timestamp', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
            .order('timestamp', { ascending: true })
            .limit(1)
            .single();

          const { data: newest } = await (supabase as any)
            .from('price_data')
            .select('timestamp')
            .eq('symbol', sym)
            .lt('timestamp', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
            .order('timestamp', { ascending: false })
            .limit(1)
            .single();

          symbolStats.push({
            symbol: sym,
            total_rows: count,
            oldest: oldest?.timestamp || '?',
            newest: newest?.timestamp || '?',
          });
        }
      }
      setPriceStats(symbolStats);

      // Query 2: data profile for ADA-EUR
      const { data: profile } = await (supabase as any)
        .from('price_data')
        .select('interval_type, source')
        .eq('symbol', 'ADA-EUR')
        .limit(1);
      if (profile) setDataProfile(profile);

      setIntegrityRan(true);
    } catch (e) {
      console.error('Integrity check error:', e);
    } finally {
      setIntegrityLoading(false);
    }
  }

  const lastRun = logs[0];
  const isStale = lastRun && (Date.now() - new Date(lastRun.created_at).getTime()) > 26 * 60 * 60 * 1000;
  const isFailed = lastRun && lastRun.prune_status !== 'success' && lastRun.prune_status !== 'skipped';
  const duplicateFiles = files.filter(f => f.isDuplicate);

  function statusBadge(status: string) {
    switch (status) {
      case 'success':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400"><CheckCircle className="w-3 h-3" /> {status}</span>;
      case 'failed':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400"><XCircle className="w-3 h-3" /> {status}</span>;
      case 'partial':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400"><AlertTriangle className="w-3 h-3" /> {status}</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/20 text-slate-400">{status}</span>;
    }
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return (
    <div className="space-y-6">
      {/* Alerts */}
      {(isStale || isFailed) && (
        <Alert className="bg-red-900/30 border-red-700">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <AlertDescription className="text-red-300">
            {isStale && 'Le dernier run date de plus de 24h. '}
            {isFailed && `Dernier statut: ${lastRun.prune_status} — ${lastRun.error_message || 'unknown error'}`}
          </AlertDescription>
        </Alert>
      )}

      {duplicateFiles.length > 0 && (
        <Alert className="bg-yellow-900/30 border-yellow-700">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
          <AlertDescription className="text-yellow-300">
            {duplicateFiles.length} fichiers orphelins détectés avec des eTag identiques (fichiers tronqués uploadés avant validation).
          </AlertDescription>
        </Alert>
      )}

      {/* Last run status */}
      {lastRun && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-slate-200 flex items-center gap-2">
              <Archive className="w-4 h-4" /> Dernier run
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-slate-400">Date:</span> <span className="text-slate-200">{lastRun.archive_date}</span></div>
              <div><span className="text-slate-400">Statut:</span> {statusBadge(lastRun.prune_status)}</div>
              <div><span className="text-slate-400">Exportées:</span> <span className="text-slate-200">{lastRun.row_count_exported.toLocaleString()}</span></div>
              <div><span className="text-slate-400">Prunées:</span> <span className="text-slate-200">{lastRun.row_count_deleted.toLocaleString()}</span></div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent runs table */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base text-slate-200">Historique des runs</CardTitle>
            <CardDescription className="text-slate-400">10 derniers runs du lifecycle</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={loadArchiveLogs}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-left py-2 px-2">Statut</th>
                  <th className="text-right py-2 px-2">Exportées</th>
                  <th className="text-right py-2 px-2">Prunées</th>
                  <th className="text-left py-2 px-2">Fichier</th>
                  <th className="text-left py-2 px-2">Erreur</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 10).map(log => (
                  <tr key={log.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="py-2 px-2 text-slate-300">{log.archive_date}</td>
                    <td className="py-2 px-2">{statusBadge(log.prune_status)}</td>
                    <td className="py-2 px-2 text-right text-slate-300">{log.row_count_exported.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right text-slate-300">{log.row_count_deleted.toLocaleString()}</td>
                    <td className="py-2 px-2 text-slate-400 font-mono text-[10px] max-w-[150px] truncate">{log.file_path}</td>
                    <td className="py-2 px-2 text-red-400 max-w-[200px] truncate" title={log.error_message || ''}>
                      {log.error_message ? log.error_message.slice(0, 60) + '…' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Storage files */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-slate-200 flex items-center gap-2">
            <FileText className="w-4 h-4" /> Fichiers dans le bucket
          </CardTitle>
          <CardDescription className="text-slate-400">price-data-archives</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="text-left py-2 px-2">Dossier</th>
                  <th className="text-left py-2 px-2">Fichier</th>
                  <th className="text-right py-2 px-2">Taille</th>
                  <th className="text-left py-2 px-2">eTag</th>
                  <th className="text-left py-2 px-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f, i) => (
                  <tr key={i} className={`border-b border-slate-700/50 ${f.isDuplicate ? 'bg-red-900/10' : ''}`}>
                    <td className="py-2 px-2 text-slate-300">{f.folder}/</td>
                    <td className="py-2 px-2 text-slate-400 font-mono text-[10px]">{f.name}</td>
                    <td className="py-2 px-2 text-right text-slate-300">{formatBytes(f.size)}</td>
                    <td className="py-2 px-2 text-slate-500 font-mono text-[10px]">{f.etag.slice(1, 9)}…</td>
                    <td className="py-2 px-2">
                      {f.isDuplicate ? (
                        <span className="inline-flex items-center gap-1 text-red-400">
                          <Trash2 className="w-3 h-3" /> Orphelin
                        </span>
                      ) : (
                        <span className="text-green-400">
                          <CheckCircle className="w-3 h-3 inline" /> OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Integrity checks */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base text-slate-200 flex items-center gap-2">
              <Database className="w-4 h-4" /> Vérification d'intégrité
            </CardTitle>
            <CardDescription className="text-slate-400">Lignes price_data en attente de prune (&gt;30j)</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={runIntegrityChecks} disabled={integrityLoading}>
            {integrityLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-1">Vérifier</span>
          </Button>
        </CardHeader>
        <CardContent>
          {!integrityRan ? (
            <p className="text-slate-500 text-sm">Cliquez sur "Vérifier" pour lancer les requêtes de diagnostic.</p>
          ) : priceStats.length === 0 ? (
            <p className="text-green-400 text-sm">✓ Aucune ligne en attente de prune.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left py-2 px-2">Symbol</th>
                    <th className="text-right py-2 px-2">Lignes</th>
                    <th className="text-left py-2 px-2">Plus ancienne</th>
                    <th className="text-left py-2 px-2">Plus récente</th>
                  </tr>
                </thead>
                <tbody>
                  {priceStats.map(s => (
                    <tr key={s.symbol} className="border-b border-slate-700/50">
                      <td className="py-2 px-2 text-slate-300 font-mono">{s.symbol}</td>
                      <td className="py-2 px-2 text-right text-yellow-400 font-bold">{s.total_rows.toLocaleString()}</td>
                      <td className="py-2 px-2 text-slate-400 text-[10px]">{new Date(s.oldest).toISOString().slice(0, 16)}</td>
                      <td className="py-2 px-2 text-slate-400 text-[10px]">{new Date(s.newest).toISOString().slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-right text-xs text-slate-500">
                Total: {priceStats.reduce((sum, s) => sum + s.total_rows, 0).toLocaleString()} lignes à archiver
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
