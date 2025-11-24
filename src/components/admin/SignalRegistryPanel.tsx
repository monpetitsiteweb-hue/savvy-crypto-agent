import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { fromTable } from "@/utils/supa";
import { Database, TrendingUp, TrendingDown, BarChart3, Zap, Edit, Save, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface SignalRegistryEntry {
  id: string;
  key: string;
  category: string;
  description: string | null;
  default_weight: number;
  min_weight: number;
  max_weight: number;
  direction_hint: string;
  timeframe_hint: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export function SignalRegistryPanel() {
  const [signals, setSignals] = useState<SignalRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSignal, setEditingSignal] = useState<SignalRegistryEntry | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<SignalRegistryEntry>>({});
  const { toast } = useToast();

  useEffect(() => {
    loadSignals();
  }, []);

  const loadSignals = async () => {
    try {
      setLoading(true);
      const { data, error } = await fromTable('signal_registry')
        .select('*')
        .order('category', { ascending: true })
        .order('key', { ascending: true });

      if (error) throw error;
      setSignals((data as SignalRegistryEntry[]) || []);
    } catch (error) {
      console.error('Error loading signals:', error);
      toast({
        title: "Error",
        description: "Failed to load signal registry",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const openEditDialog = (signal: SignalRegistryEntry) => {
    setEditingSignal(signal);
    setEditFormData({
      description: signal.description,
      default_weight: signal.default_weight,
      min_weight: signal.min_weight,
      max_weight: signal.max_weight,
      is_enabled: signal.is_enabled
    });
  };

  const updateSignal = async () => {
    if (!editingSignal) return;

    try {
      const { error } = await fromTable('signal_registry')
        .update(editFormData)
        .eq('id', editingSignal.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Signal updated successfully",
      });

      setEditingSignal(null);
      setEditFormData({});
      loadSignals();
    } catch (error) {
      console.error('Error updating signal:', error);
      toast({
        title: "Error",
        description: "Failed to update signal",
        variant: "destructive",
      });
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'technical':
        return <BarChart3 className="w-4 h-4" />;
      case 'sentiment':
        return <TrendingUp className="w-4 h-4" />;
      case 'whale':
        return <Zap className="w-4 h-4" />;
      default:
        return <Database className="w-4 h-4" />;
    }
  };

  const getDirectionBadge = (direction: string) => {
    switch (direction) {
      case 'bullish':
        return <Badge className="bg-green-500/20 text-green-400"><TrendingUp className="w-3 h-3 mr-1" />Bullish</Badge>;
      case 'bearish':
        return <Badge className="bg-red-500/20 text-red-400"><TrendingDown className="w-3 h-3 mr-1" />Bearish</Badge>;
      default:
        return <Badge variant="outline">{direction}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-400">Loading signal registry...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-slate-900/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Database className="w-5 h-5" />
            Signal Registry
          </CardTitle>
          <CardDescription className="text-slate-400">
            Manage global signal types, weights, and defaults. These settings apply system-wide unless overridden per-strategy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead className="text-slate-400">Signal Type</TableHead>
                  <TableHead className="text-slate-400">Category</TableHead>
                  <TableHead className="text-slate-400">Direction</TableHead>
                  <TableHead className="text-slate-400">Timeframe</TableHead>
                  <TableHead className="text-slate-400">Weight</TableHead>
                  <TableHead className="text-slate-400">Range</TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-slate-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((signal) => (
                  <TableRow key={signal.id} className="border-slate-700">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getCategoryIcon(signal.category)}
                        <code className="text-sm text-slate-300">{signal.key}</code>
                      </div>
                      {signal.description && (
                        <div className="text-xs text-slate-500 mt-1">{signal.description}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{signal.category}</Badge>
                    </TableCell>
                    <TableCell>
                      {getDirectionBadge(signal.direction_hint)}
                    </TableCell>
                    <TableCell>
                      <code className="text-sm text-slate-400">{signal.timeframe_hint}</code>
                    </TableCell>
                    <TableCell>
                      <span className="text-white font-mono">{signal.default_weight.toFixed(1)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-slate-400 text-sm font-mono">
                        {signal.min_weight.toFixed(1)} - {signal.max_weight.toFixed(1)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {signal.is_enabled ? (
                        <Badge className="bg-green-500/20 text-green-400">Enabled</Badge>
                      ) : (
                        <Badge className="bg-slate-500/20 text-slate-400">Disabled</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(signal)}
                        className="text-slate-400 hover:text-white"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingSignal} onOpenChange={(open) => !open && setEditingSignal(null)}>
        <DialogContent className="bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Signal: {editingSignal?.key}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="description" className="text-slate-300">Description</Label>
              <Input
                id="description"
                value={editFormData.description || ''}
                onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label htmlFor="default_weight" className="text-slate-300">Default Weight</Label>
              <Input
                id="default_weight"
                type="number"
                step="0.1"
                value={editFormData.default_weight || 1.0}
                onChange={(e) => setEditFormData({ ...editFormData, default_weight: parseFloat(e.target.value) })}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="min_weight" className="text-slate-300">Min Weight</Label>
                <Input
                  id="min_weight"
                  type="number"
                  step="0.1"
                  value={editFormData.min_weight || 0}
                  onChange={(e) => setEditFormData({ ...editFormData, min_weight: parseFloat(e.target.value) })}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div>
                <Label htmlFor="max_weight" className="text-slate-300">Max Weight</Label>
                <Input
                  id="max_weight"
                  type="number"
                  step="0.1"
                  value={editFormData.max_weight || 3}
                  onChange={(e) => setEditFormData({ ...editFormData, max_weight: parseFloat(e.target.value) })}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="is_enabled"
                checked={editFormData.is_enabled ?? true}
                onCheckedChange={(checked) => setEditFormData({ ...editFormData, is_enabled: checked })}
              />
              <Label htmlFor="is_enabled" className="text-slate-300">Enabled</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingSignal(null)} className="text-slate-400">
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={updateSignal} className="bg-green-600 hover:bg-green-700">
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
