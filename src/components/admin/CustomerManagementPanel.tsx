import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Users, Search, ChevronLeft, ChevronRight, Mail, Calendar, Shield, Link } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Customer {
  id: string;
  email: string;
  created_at: string;
  full_name?: string;
  avatar_url?: string;
  role?: string;
  has_coinbase_connection?: boolean;
  total_strategies?: number;
  last_active?: string;
}

export const CustomerManagementPanel = () => {
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const customersPerPage = 30;

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      // Calculate offset for pagination
      const offset = (currentPage - 1) * customersPerPage;

      // Build search filter
      let query = supabase
        .from('profiles')
        .select(`
          id,
          full_name,
          avatar_url,
          created_at,
          updated_at
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + customersPerPage - 1);

      // Apply search filter if provided
      if (searchTerm.trim()) {
        query = query.or(`full_name.ilike.%${searchTerm}%,id.ilike.%${searchTerm}%`);
      }

      const { data: profilesData, error: profilesError, count } = await query;

      if (profilesError) {
        throw profilesError;
      }

      setTotalCustomers(count || 0);

      if (!profilesData || profilesData.length === 0) {
        setCustomers([]);
        return;
      }

      // Get user emails from auth schema through user_roles table
      const userIds = profilesData.map(p => p.id);
      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('user_id, role');

      // Get user strategies count
      const { data: strategiesData } = await supabase
        .from('trading_strategies')
        .select('user_id')
        .in('user_id', userIds);

      // Get Coinbase connections
      const { data: connectionsData } = await supabase
        .from('user_coinbase_connections')
        .select('user_id, is_active')
        .in('user_id', userIds)
        .eq('is_active', true);

      // Combine all data
      const enrichedCustomers: Customer[] = profilesData.map(profile => {
        const userRole = rolesData?.find(r => r.user_id === profile.id);
        const userStrategies = strategiesData?.filter(s => s.user_id === profile.id) || [];
        const hasCoinbaseConnection = connectionsData?.some(c => c.user_id === profile.id) || false;

        return {
          id: profile.id,
          email: profile.id, // We'll use ID as placeholder for email since we can't access auth.users
          created_at: profile.created_at,
          full_name: profile.full_name || undefined,
          avatar_url: profile.avatar_url || undefined,
          role: userRole?.role || 'user',
          has_coinbase_connection: hasCoinbaseConnection,
          total_strategies: userStrategies.length,
          last_active: profile.updated_at
        };
      });

      setCustomers(enrichedCustomers);
    } catch (error) {
      console.error('Error fetching customers:', error);
      toast({
        title: "Error",
        description: "Failed to fetch customer data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [currentPage, searchTerm]);

  const totalPages = Math.ceil(totalCustomers / customersPerPage);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'premium':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      default:
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    }
  };

  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <Users className="w-5 h-5" />
              Customer Management
            </CardTitle>
            <CardDescription>
              View and manage customer accounts ({totalCustomers} total customers)
            </CardDescription>
          </div>
          <Button onClick={fetchCustomers} variant="outline" size="sm">
            Refresh
          </Button>
        </div>
        
        {/* Search */}
        <div className="flex items-center gap-2 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="Search customers by name or ID..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1); // Reset to first page when searching
              }}
              className="pl-10 bg-slate-700 border-slate-600 text-white"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
          </div>
        ) : customers.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            {searchTerm ? 'No customers found matching your search.' : 'No customers found.'}
          </div>
        ) : (
          <>
            {/* Customer List */}
            <div className="space-y-4">
              {customers.map((customer) => (
                <div
                  key={customer.id}
                  className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg border border-slate-600 hover:bg-slate-700/70 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className="w-10 h-10 bg-cyan-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      {customer.avatar_url ? (
                        <img 
                          src={customer.avatar_url} 
                          alt={customer.full_name || 'User'} 
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        getInitials(customer.full_name || customer.email)
                      )}
                    </div>

                    {/* Customer Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-medium">
                          {customer.full_name || 'Unknown User'}
                        </h3>
                        <Badge 
                          variant="outline" 
                          className={getRoleBadgeColor(customer.role || 'user')}
                        >
                          {customer.role === 'admin' && <Shield className="w-3 h-3 mr-1" />}
                          {customer.role || 'user'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-400 mt-1">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          ID: {customer.id.slice(0, 8)}...
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Joined {formatDate(customer.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Customer Stats */}
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <div className="text-white font-medium">{customer.total_strategies || 0}</div>
                      <div className="text-slate-400">Strategies</div>
                    </div>
                    <div className="text-center">
                      <div className={`flex items-center gap-1 ${customer.has_coinbase_connection ? 'text-green-400' : 'text-slate-400'}`}>
                        <Link className="w-3 h-3" />
                        {customer.has_coinbase_connection ? 'Connected' : 'Not Connected'}
                      </div>
                      <div className="text-slate-400">Coinbase</div>
                    </div>
                    <div className="text-center">
                      <div className="text-white font-medium">
                        {customer.last_active ? formatDate(customer.last_active) : 'Never'}
                      </div>
                      <div className="text-slate-400">Last Active</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-600">
                <div className="text-sm text-slate-400">
                  Showing {(currentPage - 1) * customersPerPage + 1} to {Math.min(currentPage * customersPerPage, totalCustomers)} of {totalCustomers} customers
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="flex items-center gap-1"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </Button>
                  <span className="text-sm text-slate-400 px-2">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="flex items-center gap-1"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};