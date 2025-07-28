import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Users, Search, ChevronLeft, ChevronRight, Mail, Calendar, Shield, Link, Trash2 } from 'lucide-react';
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
  has_profile?: boolean;
  has_role?: boolean;
  confirmed?: boolean;
  error?: boolean;
}

export const CustomerManagementPanel = () => {
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [orphanedData, setOrphanedData] = useState<any[]>([]);
  const [showOrphaned, setShowOrphaned] = useState(false);
  const customersPerPage = 30;

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      // Call edge function to get all auth.users with their profiles and roles
      const { data: customersData, error: customersError } = await supabase.functions.invoke('get-all-customers', {
        body: { 
          offset: (currentPage - 1) * customersPerPage,
          limit: customersPerPage,
          searchTerm: searchTerm.trim()
        }
      });

      if (customersError) {
        throw customersError;
      }

      setTotalCustomers(customersData.total_count || 0);
      setCustomers(customersData.customers || []);

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
    fetchOrphanedData();
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

  const handleDeleteUser = async (userId: string) => {
    setDeletingUserId(userId);
    try {
      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: { userId }
      });

      if (error) {
        throw error;
      }

      toast({
        title: "Success",
        description: "User has been permanently deleted",
      });

      // Refresh the customer list
      await fetchCustomers();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive",
      });
    } finally {
      setDeletingUserId(null);
    }
  };

  const fetchOrphanedData = async () => {
    try {
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (!roles) return;

      const orphaned = [];
      for (const role of roles) {
        try {
          const { data: authUser, error } = await supabase.auth.admin.getUserById(role.user_id);
          if (error || !authUser.user) {
            orphaned.push(role);
          }
        } catch {
          orphaned.push(role);
        }
      }
      
      setOrphanedData(orphaned);
    } catch (error) {
      console.error('Error fetching orphaned data:', error);
    }
  };

  const handleUserSyncAudit = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('user-sync-audit');

      if (error) {
        throw error;
      }

      toast({
        title: "Sync Audit Complete",
        description: `${data.users_repaired} users repaired, ${data.errors_encountered} errors`,
      });

      // Refresh the customer list
      await fetchCustomers();
      await fetchOrphanedData();
    } catch (error: any) {
      console.error('Error running sync audit:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to run sync audit",
        variant: "destructive",
      });
    }
  };

  const handleCleanupOrphanedData = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-orphaned-data');

      if (error) {
        throw error;
      }

      toast({
        title: "Success",
        description: data.message || "Orphaned data cleaned up successfully",
      });

      // Refresh both lists
      await fetchCustomers();
      await fetchOrphanedData();
    } catch (error: any) {
      console.error('Error cleaning up orphaned data:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to cleanup orphaned data",
        variant: "destructive",
      });
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
          <div className="flex gap-2">
            <Button onClick={fetchCustomers} variant="outline" size="sm">
              Refresh
            </Button>
            <Button onClick={handleUserSyncAudit} variant="outline" size="sm" className="text-green-400 border-green-400 hover:bg-green-400/10">
              Sync Audit & Repair
            </Button>
            <Button 
              onClick={() => setShowOrphaned(!showOrphaned)} 
              variant="outline" 
              size="sm"
              className="text-yellow-400 border-yellow-400 hover:bg-yellow-400/10"
            >
              {showOrphaned ? 'Hide' : 'Show'} Orphaned Data ({orphanedData.length})
            </Button>
            <Button onClick={handleCleanupOrphanedData} variant="outline" size="sm" className="text-orange-400 border-orange-400 hover:bg-orange-400/10">
              Cleanup Orphaned Data
            </Button>
          </div>
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
        {/* Orphaned Data Section */}
        {showOrphaned && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <h3 className="text-yellow-400 font-medium mb-3">Orphaned User Data</h3>
            {orphanedData.length === 0 ? (
              <p className="text-slate-400">No orphaned data found.</p>
            ) : (
              <div className="space-y-2">
                {orphanedData.map((item) => (
                  <div key={item.user_id} className="flex items-center justify-between p-2 bg-slate-700/50 rounded border border-slate-600">
                    <div className="text-sm">
                      <span className="text-white">User ID: {item.user_id}</span>
                      <span className="text-slate-400 ml-4">Role: {item.role}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
                          {customer.role === 'no-role' ? 'NO ROLE' : customer.role === 'error' ? 'ERROR' : customer.role || 'user'}
                        </Badge>
                        {(!customer.has_profile || !customer.has_role) && (
                          <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30">
                            SYNC ISSUE
                          </Badge>
                        )}
                        {!customer.confirmed && (
                          <Badge variant="outline" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                            UNCONFIRMED
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-400 mt-1">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {customer.email}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Joined {formatDate(customer.created_at)}
                        </span>
                        <span className="text-xs">
                          Profile: {customer.has_profile ? '✅' : '❌'} | Role: {customer.has_role ? '✅' : '❌'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Customer Stats & Actions */}
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
                    
                    {/* Delete Button */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-400 border-red-400 hover:bg-red-400/10 hover:text-red-300"
                          disabled={deletingUserId === customer.id}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-slate-800 border-slate-700">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-white">Delete User Account</AlertDialogTitle>
                          <AlertDialogDescription className="text-slate-400">
                            Are you sure you want to permanently delete this user account? This action will:
                            <ul className="list-disc list-inside mt-2 space-y-1">
                              <li>Remove the user from the authentication system</li>
                              <li>Delete all their trading strategies and history</li>
                              <li>Remove all their data and connections</li>
                            </ul>
                            <br />
                            <strong className="text-red-400">This action cannot be undone.</strong>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-slate-700 border-slate-600 text-white hover:bg-slate-600">
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteUser(customer.id)}
                            className="bg-red-600 hover:bg-red-700 text-white"
                            disabled={deletingUserId === customer.id}
                          >
                            {deletingUserId === customer.id ? 'Deleting...' : 'Delete User'}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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