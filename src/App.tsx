import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, 
  History, 
  BarChart3, 
  Plus, 
  Leaf, 
  Users, 
  ShoppingBag, 
  Weight, 
  CircleDollarSign,
  ChevronRight,
  Trash2,
  X,
  TrendingUp,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Calendar,
  Edit2,
  CheckCircle2,
  XCircle,
  LogOut,
  AlertCircle,
  Wifi,
  WifiOff,
  RefreshCw,
  Cloud,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfToday, isSameDay, startOfWeek, endOfWeek, eachDayOfInterval, subDays, subWeeks, isWithinInterval } from 'date-fns';
import { HarvestEntry, View, RATE_PER_KG, BagEntry } from './types';
import { db, auth } from './firebase';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc,
  getDocFromServer,
  where
} from 'firebase/firestore';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { getAIInsights, getWorkerPerformanceInsights } from './services/gemini';
import { cn } from './lib/utils';
import ReactMarkdown from 'react-markdown';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  Legend,
  Cell
} from 'recharts';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-white p-8 rounded-[32px] shadow-xl border border-gray-100 max-w-md space-y-4">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="text-red-500" size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Something went wrong</h2>
            <p className="text-gray-500 text-sm">
              {this.state.error?.message?.includes('permission') 
                ? "You don't have permission to access this data. Please check your account or contact support."
                : "An unexpected error occurred. Please try refreshing the page."}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-forest-green text-white py-3 rounded-2xl font-bold hover:bg-forest-green/90 transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isGuest, setIsGuest] = useState(true);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [entries, setEntries] = useState<HarvestEntry[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<HarvestEntry | null>(null);
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [workerInsights, setWorkerInsights] = useState<string | null>(null);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isGeneratingWorkerAI, setIsGeneratingWorkerAI] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [hasPendingWrites, setHasPendingWrites] = useState(false);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (user) {
        setIsGuest(false);
        localStorage.removeItem('tea_harvest_guest_mode');
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Guest data listener
  useEffect(() => {
    if (isGuest && !user) {
      const saved = localStorage.getItem('tea_harvest_guest_entries');
      if (saved) {
        try {
          setEntries(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to parse guest entries', e);
        }
      }
    }
  }, [isGuest, user]);

  // Save guest data
  useEffect(() => {
    if (isGuest && !user) {
      localStorage.setItem('tea_harvest_guest_entries', JSON.stringify(entries));
    }
  }, [entries, isGuest, user]);

  // Online/Offline listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Firestore listener
  useEffect(() => {
    if (!user) {
      if (!isGuest) setEntries([]);
      return;
    }

    const q = query(
      collection(db, 'harvests'),
      where('uid', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      const newEntries = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as HarvestEntry[];
      setEntries(newEntries);
      setHasPendingWrites(snapshot.metadata.hasPendingWrites);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'harvests');
    });

    return () => unsubscribe();
  }, [user]);

  // Test connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  const today = startOfToday();
  const todayEntries = useMemo(() => 
    entries.filter(e => isSameDay(new Date(e.timestamp), today)),
  [entries, today]);

  const stats = useMemo(() => {
    const workers = new Set(todayEntries.map(e => e.workerName)).size;
    const bags = todayEntries.reduce((acc, curr) => acc + curr.bags.length, 0);
    const kg = todayEntries.reduce((acc, curr) => acc + curr.totalKg, 0);
    const pay = todayEntries.reduce((acc, curr) => acc + curr.totalPay, 0);
    return { workers, bags, kg, pay };
  }, [todayEntries]);

  const handleAddEntry = async (entry: HarvestEntry) => {
    if (isGuest && !user) {
      setEntries([entry, ...entries]);
      setIsAddModalOpen(false);
      return;
    }

    if (!user) return;
    try {
      const { id, ...data } = entry;
      await addDoc(collection(db, 'harvests'), {
        ...data,
        uid: user.uid
      });
      setIsAddModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'harvests');
    }
  };

  const handleUpdateEntry = async (entry: HarvestEntry) => {
    if (isGuest && !user) {
      setEntries(entries.map(e => e.id === entry.id ? entry : e));
      setEditingEntry(null);
      return;
    }

    try {
      const { id, ...data } = entry;
      await updateDoc(doc(db, 'harvests', id), data);
      setEditingEntry(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `harvests/${entry.id}`);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (isGuest && !user) {
      setEntries(entries.filter(e => e.id !== id));
      return;
    }

    try {
      await deleteDoc(doc(db, 'harvests', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `harvests/${id}`);
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setIsGuest(true);
      setCurrentView('dashboard');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-forest-green border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Loading TeaHarvest...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="bg-forest-green text-white pt-12 pb-6 px-6 rounded-b-[32px] shadow-lg">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <Leaf className="text-tea-green fill-tea-green" size={28} />
            <h1 className="text-2xl font-bold tracking-tight">TeaHarvest</h1>
          </div>
            <div className="flex items-center gap-4">
              {user && (
                <button 
                  onClick={handleLogout}
                  className="p-2 bg-white/10 rounded-full backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-colors"
                  title="Logout"
                >
                  <LogOut size={18} />
                </button>
              )}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-full backdrop-blur-md border border-white/10">
              {isOnline ? (
                hasPendingWrites ? (
                  <div className="flex items-center gap-1.5 text-orange-300">
                    <RefreshCw size={14} className="animate-spin-slow" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Syncing</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-tea-green">
                    <Cloud size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">{isGuest ? 'Local' : 'Synced'}</span>
                  </div>
                )
              ) : (
                <div className="flex items-center gap-1.5 text-red-300">
                  <WifiOff size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Offline</span>
                </div>
              )}
            </div>
            <div className="text-right">
              <p className="text-tea-green/80 text-[10px] font-bold uppercase tracking-widest">{user?.displayName || 'Guest Farmer'}</p>
              <p className="text-sm font-semibold">{format(today, 'MMM dd, yyyy')}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 -mt-4">
        <AnimatePresence mode="wait">
          {currentView === 'dashboard' && (
            <Dashboard 
              key="dashboard"
              stats={stats} 
              entries={todayEntries} 
              onDelete={handleDeleteEntry}
              onAddClick={() => setIsAddModalOpen(true)}
            />
          )}
          {currentView === 'history' && (
            <HistoryView 
              key="history"
              entries={entries} 
              onDelete={handleDeleteEntry}
            />
          )}
          {currentView === 'reports' && (
            <ReportsView 
              key="reports"
              entries={entries} 
              onGenerateAI={async () => {
                setIsGeneratingAI(true);
                const insights = await getAIInsights(entries);
                setAiInsights(insights || "No insights available.");
                setIsGeneratingAI(false);
              }}
              onGenerateWorkerAI={async () => {
                setIsGeneratingWorkerAI(true);
                const insights = await getWorkerPerformanceInsights(entries);
                setWorkerInsights(insights || "No analysis available.");
                setIsGeneratingWorkerAI(false);
              }}
              aiInsights={aiInsights}
              workerInsights={workerInsights}
              isGeneratingAI={isGeneratingAI}
              isGeneratingWorkerAI={isGeneratingWorkerAI}
            />
          )}
          {currentView === 'payroll' && (
            <PayrollView 
              key="payroll"
              entries={entries}
              onEdit={setEditingEntry}
              onUpdate={handleUpdateEntry}
            />
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-6 py-3 flex justify-between items-center shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <NavButton 
          active={currentView === 'dashboard'} 
          onClick={() => setCurrentView('dashboard')}
          icon={<LayoutDashboard size={24} />}
          label="Dashboard"
        />
        <NavButton 
          active={currentView === 'history'} 
          onClick={() => setCurrentView('history')}
          icon={<History size={24} />}
          label="History"
        />
        <NavButton 
          active={currentView === 'reports'} 
          onClick={() => setCurrentView('reports')}
          icon={<BarChart3 size={24} />}
          label="Reports"
        />
        <NavButton 
          active={currentView === 'payroll'} 
          onClick={() => setCurrentView('payroll')}
          icon={<CircleDollarSign size={24} />}
          label="Payroll"
        />
      </nav>

      {/* Modals */}
      <AnimatePresence>
        {isAddModalOpen && (
          <AddEntryModal 
            uid={user?.uid || 'guest'}
            onClose={() => setIsAddModalOpen(false)} 
            onSave={handleAddEntry} 
          />
        )}
        {editingEntry && (
          <AddEntryModal 
            uid={user?.uid || 'guest'}
            entry={editingEntry}
            onClose={() => setEditingEntry(null)} 
            onSave={handleUpdateEntry} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-colors duration-200",
        active ? "text-forest-green" : "text-gray-400"
      )}
    >
      <div className={cn(
        "p-1 rounded-xl transition-colors",
        active && "bg-tea-green/30"
      )}>
        {icon}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}

function Dashboard({ stats, entries, onDelete, onAddClick }: { key?: string, stats: any, entries: HarvestEntry[], onDelete: (id: string) => void, onAddClick: () => void }) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEntries = useMemo(() => {
    return entries.filter(e => 
      e.workerName.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [entries, searchQuery]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      {/* Metric Grid */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard icon={<Users className="text-blue-600" />} label="Workers" value={stats.workers} color="bg-blue-50" />
        <StatCard icon={<ShoppingBag className="text-orange-600" />} label="Bags" value={stats.bags} color="bg-orange-50" />
        <StatCard icon={<Weight className="text-emerald-600" />} label="Total Kg" value={`${stats.kg.toFixed(1)}`} color="bg-emerald-50" />
        <StatCard icon={<CircleDollarSign className="text-purple-600" />} label="Total Pay" value={`${stats.pay.toLocaleString()}`} color="bg-purple-50" unit="KES" />
      </div>

      {/* Entries List */}
      <div className="space-y-4">
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-800">Today's Entries</h2>
            <button 
              onClick={onAddClick}
              className="bg-forest-green text-white p-2 rounded-full shadow-lg active:scale-95 transition-transform"
            >
              <Plus size={24} />
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search for an employee..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-forest-green/20 focus:border-forest-green transition-all text-sm"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400 space-y-3">
            <div className="bg-gray-100 p-6 rounded-full">
              <Leaf size={48} className="opacity-20" />
            </div>
            <p className="font-medium">{searchQuery ? 'No matching workers found' : 'No entries yet today'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEntries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} onDelete={() => onDelete(entry.id)} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StatCard({ icon, label, value, color, unit }: { icon: React.ReactNode, label: string, value: string | number, color: string, unit?: string }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col gap-3">
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", color)}>
        {icon}
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
        <div className="flex items-baseline gap-1">
          <p className="text-xl font-bold text-gray-900">{value}</p>
          {unit && <span className="text-[10px] font-bold text-gray-400">{unit}</span>}
        </div>
      </div>
    </div>
  );
}

function EntryCard({ entry, onDelete }: { key?: string, entry: HarvestEntry, onDelete: () => void }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex justify-between items-center group">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-tea-green/20 rounded-full flex items-center justify-center text-forest-green font-bold text-lg">
          {entry.workerName.charAt(0).toUpperCase()}
        </div>
        <div>
          <h3 className="font-bold text-gray-900">{entry.workerName}</h3>
          <p className="text-xs text-gray-500 font-medium">
            {entry.bags.length} Bags • {entry.totalKg.toFixed(1)} Kg • KES {entry.ratePerKg}/Kg
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-bold text-forest-green">KES {entry.totalPay.toLocaleString()}</p>
          <p className={cn(
            "text-[10px] font-bold uppercase tracking-tighter",
            entry.status === 'paid' ? "text-forest-green" : "text-orange-500"
          )}>
            {entry.status || 'paid'}
          </p>
        </div>
        <button 
          onClick={onDelete}
          className="text-gray-300 hover:text-red-500 transition-colors p-1"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
}

function HistoryView({ entries, onDelete }: { key?: string, entries: HarvestEntry[], onDelete: (id: string) => void }) {
  const [sortBy, setSortBy] = useState<'date' | 'kg' | 'pay'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');

  const exportToCSV = () => {
    const headers = ['Date', 'Worker Name', 'Total Kg', 'Rate per Kg', 'Total Pay'];
    const rows = entries.map(entry => [
      format(new Date(entry.timestamp), 'yyyy-MM-dd HH:mm'),
      `"${entry.workerName.replace(/"/g, '""')}"`,
      entry.totalKg.toFixed(2),
      entry.ratePerKg,
      entry.totalPay.toFixed(2)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `tea_harvest_report_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sortedEntries = useMemo(() => {
    return [...entries]
      .filter(entry => 
        entry.workerName.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'date') {
          comparison = b.timestamp - a.timestamp;
        } else if (sortBy === 'kg') {
          comparison = a.totalKg - b.totalKg;
        } else if (sortBy === 'pay') {
          comparison = a.totalPay - b.totalPay;
        }
        return sortOrder === 'desc' ? -comparison : comparison;
      });
  }, [entries, sortBy, sortOrder, searchQuery]);

  const groupedEntries = useMemo(() => {
    const groups: Record<string, HarvestEntry[]> = {};
    sortedEntries.forEach(entry => {
      const dateKey = format(new Date(entry.timestamp), 'yyyy-MM-dd');
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(entry);
    });
    
    // If sorting by date, keep groups sorted by date
    // If sorting by kg/pay, we might want to show a flat list or keep date grouping but sort within groups
    // The requirement says "sort entries", usually implies the order of entries.
    // Let's keep the date grouping but allow sorting within and across if needed.
    // Actually, if sorting by Kg, grouping by date might be confusing if the top Kg is in the middle of the list.
    // Let's provide a "Group by Date" toggle or just show a flat list when sorting by Kg/Pay.
    return groups;
  }, [sortedEntries]);

  const isDateSorted = sortBy === 'date';

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6 pb-12"
    >
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">Harvest History</h2>
          <div className="flex items-center gap-2">
            <button 
              onClick={exportToCSV}
              disabled={entries.length === 0}
              className="p-2 bg-white rounded-xl shadow-sm border border-gray-100 text-forest-green hover:bg-gray-50 transition-all disabled:opacity-50"
              title="Export CSV"
            >
              <Download size={18} />
            </button>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-1 flex gap-1">
              <SortButton 
                active={sortBy === 'kg'} 
                onClick={() => {
                  if (sortBy === 'kg') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  else { setSortBy('kg'); setSortOrder('desc'); }
                }}
                icon={<Weight size={14} />}
                order={sortBy === 'kg' ? sortOrder : null}
              />
              <SortButton 
                active={sortBy === 'pay'} 
                onClick={() => {
                  if (sortBy === 'pay') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  else { setSortBy('pay'); setSortOrder('desc'); }
                }}
                icon={<CircleDollarSign size={14} />}
                order={sortBy === 'pay' ? sortOrder : null}
              />
              <SortButton 
                active={sortBy === 'date'} 
                onClick={() => {
                  if (sortBy === 'date') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  else { setSortBy('date'); setSortOrder('desc'); }
                }}
                icon={<History size={14} />}
                order={sortBy === 'date' ? sortOrder : null}
              />
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search for an employee..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-forest-green/20 focus:border-forest-green transition-all text-sm"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      
      {entries.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <History size={48} className="mx-auto mb-4 opacity-20" />
          <p>No history available yet</p>
        </div>
      ) : (
        <div className="space-y-8">
          {isDateSorted ? (
            Object.entries(groupedEntries)
              .sort((a, b) => sortOrder === 'desc' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0]))
              .map(([date, dayEntries]) => (
                <div key={date} className="space-y-3">
                  <div className="flex justify-between items-center sticky top-0 bg-gray-50/90 backdrop-blur-sm py-2 z-10">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">
                      {isSameDay(new Date(date), startOfToday()) ? 'Today' : format(new Date(date), 'MMMM dd, yyyy')}
                    </h3>
                    <span className="text-[10px] font-bold bg-tea-green text-forest-green px-2 py-0.5 rounded-full">
                      {dayEntries.length} Entries
                    </span>
                  </div>
                  <div className="space-y-3">
                    {dayEntries.map(entry => (
                      <EntryCard key={entry.id} entry={entry} onDelete={() => onDelete(entry.id)} />
                    ))}
                  </div>
                </div>
              ))
          ) : (
            <div className="space-y-3">
              {sortedEntries.map(entry => (
                <div key={entry.id} className="space-y-1">
                   <p className="text-[10px] font-bold text-gray-400 uppercase ml-2">
                    {format(new Date(entry.timestamp), 'MMM dd, yyyy')}
                  </p>
                  <EntryCard entry={entry} onDelete={() => onDelete(entry.id)} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function SortButton({ active, onClick, icon, order }: { active: boolean, onClick: () => void, icon: React.ReactNode, order: 'asc' | 'desc' | null }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "p-2 rounded-lg flex items-center gap-1 transition-all",
        active ? "bg-forest-green text-white shadow-md" : "text-gray-400 hover:bg-gray-50"
      )}
    >
      {icon}
      {active && (
        order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
      )}
    </button>
  );
}

function ReportsView({ 
  entries, 
  onGenerateAI, 
  onGenerateWorkerAI,
  aiInsights, 
  workerInsights,
  isGeneratingAI,
  isGeneratingWorkerAI
}: { 
  key?: string, 
  entries: HarvestEntry[], 
  onGenerateAI: () => void, 
  onGenerateWorkerAI: () => void,
  aiInsights: string | null, 
  workerInsights: string | null,
  isGeneratingAI: boolean,
  isGeneratingWorkerAI: boolean
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const weeklyStats = useMemo(() => {
    const today = startOfToday();
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
    
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
    
    return weekDays.map(day => {
      const dayEntries = entries.filter(e => isSameDay(new Date(e.timestamp), day));
      return {
        day: format(day, 'EEE'),
        fullDate: format(day, 'MMM dd'),
        kg: dayEntries.reduce((acc, curr) => acc + curr.totalKg, 0),
        pay: dayEntries.reduce((acc, curr) => acc + curr.totalPay, 0),
        isToday: isSameDay(day, today)
      };
    });
  }, [entries]);

  const trendStats = useMemo(() => {
    const today = startOfToday();
    const weeks = [3, 2, 1, 0].map(w => {
      const targetDate = subWeeks(today, w);
      const start = startOfWeek(targetDate, { weekStartsOn: 1 });
      const end = endOfWeek(targetDate, { weekStartsOn: 1 });
      
      const weekEntries = entries.filter(e => {
        const d = new Date(e.timestamp);
        return isWithinInterval(d, { start, end });
      });

      return {
        week: `Week ${format(start, 'dd/MM')}`,
        kg: weekEntries.reduce((acc, curr) => acc + curr.totalKg, 0),
        pay: weekEntries.reduce((acc, curr) => acc + curr.totalPay, 0)
      };
    });
    return weeks;
  }, [entries]);

  const totalWeeklyKg = weeklyStats.reduce((acc, curr) => acc + curr.kg, 0);
  const totalWeeklyPay = weeklyStats.reduce((acc, curr) => acc + curr.pay, 0);

  const workerSummary = useMemo(() => {
    const summary: Record<string, { kg: number, pay: number }> = {};
    entries.forEach(entry => {
      if (!summary[entry.workerName]) {
        summary[entry.workerName] = { kg: 0, pay: 0 };
      }
      summary[entry.workerName].kg += entry.totalKg;
      summary[entry.workerName].pay += entry.totalPay;
    });
    return Object.entries(summary)
      .filter(([name]) => name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => b[1].kg - a[1].kg);
  }, [entries, searchQuery]);

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-8 pb-12"
    >
      <h2 className="text-xl font-bold text-gray-900">Harvest Reports</h2>

      {/* Weekly Summary Card */}
      <div className="bg-forest-green text-white rounded-[32px] p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <BarChart3 size={120} />
        </div>
        <div className="relative z-10">
          <p className="text-tea-green/60 text-xs font-bold uppercase tracking-[0.2em] mb-1">This Week's Total</p>
          <h3 className="text-4xl font-black mb-6">KES {totalWeeklyPay.toLocaleString()}</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3">
              <p className="text-[10px] font-bold text-tea-green/60 uppercase mb-1">Total Harvest</p>
              <p className="text-lg font-bold">{totalWeeklyKg.toFixed(1)} <span className="text-xs font-normal opacity-60">Kg</span></p>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3">
              <p className="text-[10px] font-bold text-tea-green/60 uppercase mb-1">Avg per Day</p>
              <p className="text-lg font-bold">{(totalWeeklyKg / 7).toFixed(1)} <span className="text-xs font-normal opacity-60">Kg</span></p>
            </div>
          </div>
        </div>
      </div>

      {/* Worker Summary Table */}
      <div className="space-y-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-forest-green" />
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Worker Summary</h3>
            </div>
            <div className="relative w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              <input
                type="text"
                placeholder="Search worker..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white rounded-xl border border-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-forest-green/20 focus:border-forest-green transition-all text-xs"
              />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Employee</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Total Kg</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Total Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {workerSummary.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-400 italic">No worker data available</td>
                </tr>
              ) : (
                workerSummary.map(([name, stats], idx) => (
                  <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-tea-green/20 rounded-full flex items-center justify-center text-forest-green font-bold text-xs">
                          {name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-bold text-gray-900 text-sm">{name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="font-bold text-gray-900 text-sm">{stats.kg.toFixed(1)}</span>
                      <span className="text-[10px] text-gray-400 ml-1">Kg</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="font-bold text-forest-green text-sm">KES {stats.pay.toLocaleString()}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily Breakdown Chart */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-forest-green" />
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Daily Breakdown</h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-forest-green" />
              <span className="text-[10px] font-bold text-gray-400 uppercase">Kg</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-tea-green" />
              <span className="text-[10px] font-bold text-gray-400 uppercase">KES</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-3xl p-4 shadow-sm border border-gray-100 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklyStats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis 
                dataKey="day" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} 
              />
              <YAxis 
                yAxisId="left"
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} 
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} 
              />
              <Tooltip 
                cursor={{ fill: '#f3f4f6' }}
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Bar yAxisId="left" dataKey="kg" fill="#1B4332" radius={[4, 4, 0, 0]} barSize={12} />
              <Bar yAxisId="right" dataKey="pay" fill="#D8F3DC" radius={[4, 4, 0, 0]} barSize={12} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Weekly Trends Chart */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-forest-green" />
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Weekly Trends</h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-forest-green" />
              <span className="text-[10px] font-bold text-gray-400 uppercase">Pay</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-blue-400" />
              <span className="text-[10px] font-bold text-gray-400 uppercase">Kg</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-3xl p-4 shadow-sm border border-gray-100 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendStats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis 
                dataKey="week" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} 
              />
              <YAxis 
                yAxisId="left"
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} 
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} 
              />
              <Tooltip 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }} />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="pay" 
                name="Pay (KES)"
                stroke="#1B4332" 
                strokeWidth={3} 
                dot={{ r: 4, fill: '#1B4332', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="kg" 
                name="Harvest (Kg)"
                stroke="#60A5FA" 
                strokeWidth={3} 
                dot={{ r: 4, fill: '#60A5FA', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Daily Breakdown List */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Daily List</h3>
        <div className="space-y-3">
          {weeklyStats.map((stat, idx) => (
            <div 
              key={idx}
              className={cn(
                "bg-white rounded-2xl p-4 flex justify-between items-center border border-gray-100",
                stat.isToday && "ring-2 ring-forest-green ring-offset-2"
              )}
            >
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs",
                  stat.isToday ? "bg-forest-green text-white" : "bg-gray-100 text-gray-400"
                )}>
                  {stat.day}
                </div>
                <div>
                  <p className="font-bold text-gray-900">{stat.fullDate}</p>
                  <p className="text-xs text-gray-500 font-medium">{stat.kg.toFixed(1)} Kg harvested</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-gray-900">KES {stat.pay.toLocaleString()}</p>
                <div className="w-24 h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                  <div 
                    className="h-full bg-forest-green rounded-full" 
                    style={{ width: `${Math.min((stat.kg / (totalWeeklyKg || 1)) * 100 * 3, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Insights Section */}
      <div className="space-y-4 pb-8">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">AI Insights</h3>
          <button 
            onClick={onGenerateAI}
            disabled={isGeneratingAI || entries.length === 0}
            className="text-xs font-bold text-forest-green flex items-center gap-2 bg-tea-green/30 px-4 py-2 rounded-full disabled:opacity-50"
          >
            <BarChart3 size={14} className={cn(isGeneratingAI && "animate-pulse")} />
            {isGeneratingAI ? "Analyzing..." : "Refresh Insights"}
          </button>
        </div>

        <div className="bg-white rounded-3xl p-6 border border-tea-green shadow-sm relative overflow-hidden">
          <div className="absolute -top-4 -right-4 opacity-5">
            <Leaf size={120} className="text-forest-green" />
          </div>
          
          {isGeneratingAI ? (
            <div className="space-y-3">
              <div className="h-4 bg-gray-100 rounded-full w-3/4 animate-pulse" />
              <div className="h-4 bg-gray-100 rounded-full w-full animate-pulse" />
              <div className="h-4 bg-gray-100 rounded-full w-2/3 animate-pulse" />
            </div>
          ) : aiInsights ? (
            <div className="prose prose-sm prose-forest prose-p:text-gray-600 prose-li:text-gray-600">
              <ReactMarkdown>{aiInsights}</ReactMarkdown>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-400 italic">Tap "Refresh Insights" to get AI-powered analysis of your harvest data.</p>
            </div>
          )}
        </div>
      </div>

      {/* Worker Performance Analysis Section */}
      <div className="space-y-4 pb-8">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Worker Performance</h3>
          <button 
            onClick={onGenerateWorkerAI}
            disabled={isGeneratingWorkerAI || entries.length === 0}
            className="text-xs font-bold text-forest-green flex items-center gap-2 bg-tea-green/30 px-4 py-2 rounded-full disabled:opacity-50"
          >
            <Users size={14} className={cn(isGeneratingWorkerAI && "animate-pulse")} />
            {isGeneratingWorkerAI ? "Analyzing..." : "Analyze Workers"}
          </button>
        </div>

        <div className="bg-white rounded-3xl p-6 border border-tea-green shadow-sm relative overflow-hidden">
          <div className="absolute -top-4 -right-4 opacity-5">
            <Users size={120} className="text-forest-green" />
          </div>
          
          {isGeneratingWorkerAI ? (
            <div className="space-y-3">
              <div className="h-4 bg-gray-100 rounded-full w-3/4 animate-pulse" />
              <div className="h-4 bg-gray-100 rounded-full w-full animate-pulse" />
              <div className="h-4 bg-gray-100 rounded-full w-2/3 animate-pulse" />
            </div>
          ) : workerInsights ? (
            <div className="prose prose-sm prose-forest prose-p:text-gray-600 prose-li:text-gray-600 prose-headings:text-forest-green prose-headings:font-bold prose-headings:mt-4 first:prose-headings:mt-0">
              <ReactMarkdown>{workerInsights}</ReactMarkdown>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-400 italic">Tap "Analyze Workers" to get an AI-powered performance review of your team.</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function PayrollView({ 
  entries, 
  onEdit,
  onUpdate
}: { 
  entries: HarvestEntry[], 
  onEdit: (entry: HarvestEntry) => void,
  onUpdate: (entry: HarvestEntry) => void
}) {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [searchQuery, setSearchQuery] = useState('');
  
  const dayEntries = useMemo(() => {
    return entries.filter(e => 
      e.date.startsWith(selectedDate) && 
      e.workerName.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [entries, selectedDate, searchQuery]);

  const stats = useMemo(() => {
    const totalKg = dayEntries.reduce((acc, curr) => acc + curr.totalKg, 0);
    const totalPay = dayEntries.reduce((acc, curr) => acc + curr.totalPay, 0);
    const paidCount = dayEntries.filter(e => e.status === 'paid').length;
    return { totalKg, totalPay, paidCount, totalCount: dayEntries.length };
  }, [dayEntries]);

  const toggleStatus = (entry: HarvestEntry) => {
    onUpdate({
      ...entry,
      status: entry.status === 'paid' ? 'unpaid' : 'paid'
    });
  };

  const exportToCSV = () => {
    const headers = ['Employee Name', 'Total Kg', 'Total Pay', 'Status'];
    const rows = dayEntries.map(entry => [
      `"${entry.workerName.replace(/"/g, '""')}"`,
      entry.totalKg.toFixed(2),
      entry.totalPay.toFixed(2),
      entry.status.toUpperCase()
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `payroll_${selectedDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-6 pb-12"
    >
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">Daily Payroll</h2>
          <div className="flex items-center gap-2">
            <button 
              onClick={exportToCSV}
              disabled={dayEntries.length === 0}
              className="p-2 bg-white rounded-xl shadow-sm border border-gray-100 text-forest-green hover:bg-gray-50 transition-all disabled:opacity-50"
              title="Export Payroll CSV"
            >
              <Download size={18} />
            </button>
            <div className="relative">
              <input 
                type="date" 
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-white border border-gray-100 rounded-xl px-3 py-2 text-sm font-bold text-gray-900 shadow-sm focus:ring-2 focus:ring-forest-green outline-none"
              />
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search employee in payroll..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-forest-green/20 focus:border-forest-green transition-all text-sm"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Day Summary Card */}
      <div className="bg-white rounded-[32px] p-6 shadow-sm border border-gray-100 grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Weight</p>
          <p className="text-2xl font-black text-gray-900">{stats.totalKg.toFixed(1)} <span className="text-xs font-normal text-gray-400">Kg</span></p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Payout</p>
          <p className="text-2xl font-black text-forest-green">KES {stats.totalPay.toLocaleString()}</p>
        </div>
        <div className="col-span-2 pt-2 border-top border-gray-50">
          <div className="flex justify-between items-center mb-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Payment Progress</p>
            <p className="text-[10px] font-bold text-forest-green uppercase tracking-widest">{stats.paidCount}/{stats.totalCount} Paid</p>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-forest-green transition-all duration-500" 
              style={{ width: `${(stats.paidCount / (stats.totalCount || 1)) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Employee List */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Employee Records</h3>
        {dayEntries.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-dashed border-gray-200">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="text-gray-300" size={32} />
            </div>
            <p className="text-gray-400 font-medium">No entries found for this date.</p>
          </div>
        ) : (
          <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100 overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[500px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Employee Name</th>
                  <th className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Total Kg</th>
                  <th className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Total Pay</th>
                  <th className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Status</th>
                  <th className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {dayEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-tea-green/20 rounded-lg flex items-center justify-center text-forest-green font-bold text-xs">
                          {entry.workerName.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-bold text-gray-900 text-sm">{entry.workerName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span className="font-bold text-gray-900 text-sm">{entry.totalKg.toFixed(1)}</span>
                      <span className="text-[10px] text-gray-400 ml-1">Kg</span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span className="font-bold text-forest-green text-sm">KES {entry.totalPay.toLocaleString()}</span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <button 
                        onClick={() => toggleStatus(entry)}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all",
                          entry.status === 'paid' 
                            ? "bg-forest-green/10 text-forest-green" 
                            : "bg-orange-50 text-orange-600"
                        )}
                      >
                        {entry.status === 'paid' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                        {entry.status === 'paid' ? 'Paid' : 'Unpaid'}
                      </button>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button 
                        onClick={() => onEdit(entry)}
                        className="p-1.5 text-gray-400 hover:text-forest-green hover:bg-tea-green/20 rounded-lg transition-colors"
                      >
                        <Edit2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function AddEntryModal({ entry, onClose, onSave, uid }: { entry?: HarvestEntry, onClose: () => void, onSave: (entry: HarvestEntry) => void, uid: string }) {
  const [workerName, setWorkerName] = useState(entry?.workerName || '');
  const [bags, setBags] = useState<string[]>(entry?.bags.map(b => b.weight.toString()) || ['']);
  const [ratePerKg, setRatePerKg] = useState<string>(entry?.ratePerKg.toString() || RATE_PER_KG.toString());
  const [status, setStatus] = useState<'paid' | 'unpaid'>(entry?.status || 'unpaid');

  const totalKg = useMemo(() => 
    bags.reduce((acc, curr) => acc + (parseFloat(curr) || 0), 0)
  , [bags]);

  const totalPay = totalKg * (parseFloat(ratePerKg) || 0);

  const handleAddBag = () => setBags([...bags, '']);
  const handleRemoveBag = (index: number) => {
    if (bags.length > 1) {
      const newBags = [...bags];
      newBags.splice(index, 1);
      setBags(newBags);
    }
  };

  const handleBagChange = (index: number, value: string) => {
    const newBags = [...bags];
    newBags[index] = value;
    setBags(newBags);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerName || totalKg <= 0) return;

    const bagEntries: BagEntry[] = bags
      .filter(b => parseFloat(b) > 0)
      .map(b => ({ id: Math.random().toString(36).substr(2, 9), weight: parseFloat(b) }));

    const newEntry: HarvestEntry = {
      id: entry?.id || Math.random().toString(36).substr(2, 9),
      workerName,
      bags: bagEntries,
      totalKg,
      totalPay,
      ratePerKg: parseFloat(ratePerKg) || RATE_PER_KG,
      date: entry?.date || new Date().toISOString(),
      timestamp: entry?.timestamp || Date.now(),
      status: status,
      uid: uid
    };

    onSave(newEntry);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative w-full max-w-lg bg-white rounded-t-[32px] sm:rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">{entry ? 'Edit Harvest Entry' : 'New Harvest Entry'}</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto">
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Worker Name</label>
            <input 
              autoFocus
              type="text" 
              required
              value={workerName}
              onChange={(e) => setWorkerName(e.target.value)}
              placeholder="Enter name"
              className="w-full bg-gray-50 border-none rounded-2xl p-4 font-bold text-gray-900 focus:ring-2 focus:ring-forest-green transition-all"
            />
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Bags (Weight in Kg)</label>
              <button 
                type="button"
                onClick={handleAddBag}
                className="text-xs font-bold text-forest-green flex items-center gap-1 bg-tea-green/30 px-3 py-1.5 rounded-full"
              >
                <Plus size={14} /> Add Bag
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {bags.map((bag, idx) => (
                <div key={idx} className="relative group">
                  <input 
                    type="number" 
                    step="0.1"
                    required
                    value={bag}
                    onChange={(e) => handleBagChange(idx, e.target.value)}
                    placeholder={`Bag ${idx + 1}`}
                    className="w-full bg-gray-50 border-none rounded-2xl p-4 font-bold text-gray-900 focus:ring-2 focus:ring-forest-green transition-all"
                  />
                  {bags.length > 1 && (
                    <button 
                      type="button"
                      onClick={() => handleRemoveBag(idx)}
                      className="absolute -top-2 -right-2 bg-white text-red-500 p-1 rounded-full shadow-md border border-gray-100"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Rate per Kg (KES)</label>
            <input 
              type="number" 
              required
              value={ratePerKg}
              onChange={(e) => setRatePerKg(e.target.value)}
              placeholder="Enter rate"
              className="w-full bg-gray-50 border-none rounded-2xl p-4 font-bold text-gray-900 focus:ring-2 focus:ring-forest-green transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Payment Status</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStatus('unpaid')}
                className={cn(
                  "flex-1 py-3 rounded-2xl font-bold text-sm transition-all border-2",
                  status === 'unpaid' 
                    ? "bg-orange-50 border-orange-500 text-orange-600" 
                    : "bg-gray-50 border-transparent text-gray-400"
                )}
              >
                Unpaid
              </button>
              <button
                type="button"
                onClick={() => setStatus('paid')}
                className={cn(
                  "flex-1 py-3 rounded-2xl font-bold text-sm transition-all border-2",
                  status === 'paid' 
                    ? "bg-forest-green/10 border-forest-green text-forest-green" 
                    : "bg-gray-50 border-transparent text-gray-400"
                )}
              >
                Paid
              </button>
            </div>
          </div>

          {/* Calculation Summary */}
          <div className="bg-tea-green/20 rounded-2xl p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-600">Total Weight</span>
              <span className="text-lg font-bold text-forest-green">{totalKg.toFixed(1)} Kg</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-600">Rate per Kg</span>
              <span className="text-sm font-bold text-gray-900">KES {parseFloat(ratePerKg) || 0}</span>
            </div>
            <div className="h-px bg-forest-green/10" />
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-gray-900">Total Pay</span>
              <span className="text-xl font-black text-forest-green">KES {totalPay.toLocaleString()}</span>
            </div>
          </div>

          <button 
            type="submit"
            disabled={!workerName || totalKg <= 0}
            className="w-full bg-forest-green text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-forest-green/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100"
          >
            {entry ? 'Update Harvest' : 'Save Harvest'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
