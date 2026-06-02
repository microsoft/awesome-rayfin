import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  DatabaseIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { ServiceContainer } from '@/services/ServiceContainer';
import { getRayfinClient } from '@/services/rayfin/RayfinClientService';

import type { Customer } from '../../rayfin/data/Customer';
import type { Job } from '../../rayfin/data/Job';
import type { Region } from '../../rayfin/data/Region';
import type { UserProfile } from '../../rayfin/data/UserProfile';

const FAKE_FIRST_NAMES = [
  'Alice', 'Bob', 'Carlos', 'Diana', 'Ethan', 'Fatima', 'George',
  'Hannah', 'Ivan', 'Julia', 'Kevin', 'Luna', 'Marcus', 'Nadia',
  'Oscar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tanya',
];

const FAKE_LAST_NAMES = [
  'Johnson', 'Smith', 'Williams', 'Brown', 'Garcia', 'Miller',
  'Davis', 'Rodriguez', 'Martinez', 'Anderson', 'Taylor', 'Thomas',
  'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris',
];

const FAKE_JOB_TITLES = [
  'HVAC Repair', 'Furnace Inspection', 'AC Unit Replacement',
  'Duct Cleaning', 'Thermostat Installation', 'Heat Pump Service',
  'Boiler Maintenance', 'Refrigerant Recharge', 'Air Filter Replacement',
  'Ventilation Check', 'Compressor Repair', 'Emergency Heating Fix',
  'Coolant Leak Repair', 'Annual System Checkup', 'New Unit Installation',
  'Pipe Insulation', 'Zone Control Setup', 'Exhaust Fan Repair',
  'Water Heater Service', 'Gas Line Inspection',
];

const FAKE_STREETS = [
  'Main St', 'Oak Ave', 'Pine Rd', 'Elm Dr', 'Maple Ln',
  'Cedar Blvd', 'Birch Way', 'Spruce Ct', 'Walnut Pl', 'Cherry St',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randPhone(): string {
  const area = Math.floor(200 + Math.random() * 800);
  const mid = Math.floor(200 + Math.random() * 800);
  const end = Math.floor(1000 + Math.random() * 9000);
  return `(${area}) ${mid}-${end}`;
}

function randAddress(): string {
  const num = Math.floor(100 + Math.random() * 9900);
  return `${num} ${pick(FAKE_STREETS)}`;
}

function randFutureDate(): Date {
  const now = Date.now();
  const offset = Math.floor(Math.random() * 14 * 24 * 60 * 60 * 1000);
  return new Date(now + offset);
}

export function AdminPage() {
  const services = ServiceContainer.getInstance();

  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('profiles');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, r, c, j] = await Promise.allSettled([
        services.userProfileService.getProfilesByRole('technician').then(async (techs) => {
          const dispatchers = await services.userProfileService.getProfilesByRole('dispatcher');
          return [...techs, ...dispatchers];
        }),
        services.regionService.getRegions(),
        services.customerService.getAllCustomers(),
        services.jobService.getUnscheduledJobs().then(async (u) => {
          const ip = await services.jobService.getInProgressJobs();
          const o = await services.jobService.getOverdueJobs();
          const h = await services.jobService.getHelpRequestJobs();
          const all = [...u, ...ip, ...o, ...h];
          const seen = new Set<string>();
          return all.filter((j) => {
            if (seen.has(j.id)) return false;
            seen.add(j.id);
            return true;
          });
        }),
      ]);

      if (p.status === 'fulfilled') setProfiles(p.value);
      if (r.status === 'fulfilled') setRegions(r.value);
      if (c.status === 'fulfilled') setCustomers(c.value);
      if (j.status === 'fulfilled') setJobs(j.value);
    } finally {
      setLoading(false);
    }
  }, [services]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const generateCustomers = async (count: number) => {
    setGenerating('customers');
    try {
      for (let i = 0; i < count; i++) {
        const first = pick(FAKE_FIRST_NAMES);
        const last = pick(FAKE_LAST_NAMES);
        await services.customerService.createCustomer({
          name: `${first} ${last}`,
          phone: randPhone(),
          email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
          address: randAddress(),
        });
      }
      toast.success(`Created ${count} fake customers`);
      await fetchAll();
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGenerating(null);
    }
  };

  const generateJobs = async (count: number) => {
    if (customers.length === 0 || regions.length === 0) {
      toast.error('Need at least one customer and one region first');
      return;
    }
    setGenerating('jobs');
    try {
      const technicians = profiles.filter((p) => p.role === 'technician');
      for (let i = 0; i < count; i++) {
        const shouldSchedule = Math.random() > 0.4;
        const shouldAssign = technicians.length > 0 && Math.random() > 0.5;
        await services.jobService.createJob({
          title: pick(FAKE_JOB_TITLES),
          description: `Auto-generated test job #${Date.now()}`,
          customerId: pick(customers).id,
          regionId: pick(regions).id,
          technicianId: shouldAssign ? pick(technicians).id : undefined,
          scheduledAt: shouldSchedule ? randFutureDate() : undefined,
        });
      }
      toast.success(`Created ${count} fake jobs`);
      await fetchAll();
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGenerating(null);
    }
  };

  const generateRegion = async () => {
    setGenerating('region');
    const names = ['SEA', 'PDX', 'SFO', 'LAX', 'DEN', 'CHI', 'NYC', 'ATL', 'MIA', 'DFW', 'BOS', 'PHX'];
    const existing = new Set(regions.map((r) => r.name));
    const available = names.filter((n) => !existing.has(n));
    const name = available.length > 0 ? pick(available) : `Region-${Math.floor(Math.random() * 1000)}`;
    try {
      await services.regionService.createRegion(name, `${name} metro area`);
      toast.success(`Created region: ${name}`);
      await fetchAll();
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGenerating(null);
    }
  };

  const deleteEntity = async (entity: 'UserProfile' | 'Region' | 'Customer' | 'Job', id: string) => {
    try {
      const client = getRayfinClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic entity selection is intentional for the admin delete utility
      await client.data[entity].delete({ id } as any);
      toast.success(`Deleted ${entity}`);
      await fetchAll();
    } catch (err) {
      toast.error(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2Icon className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <DatabaseIcon className="h-6 w-6" />
            <span className="text-lg font-semibold">Admin Panel</span>
            <Badge variant="destructive" className="text-xs">SECRET</Badge>
          </div>
          <Button variant="outline" size="sm" onClick={fetchAll}>
            <RefreshCwIcon className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="container mx-auto py-6 px-4 space-y-6 max-w-5xl">
        {/* Data Generation */}
        <Card>
          <CardHeader>
            <CardTitle>Generate Fake Data</CardTitle>
            <CardDescription>Quickly populate the database for testing</CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={generateRegion}
                disabled={generating !== null}
              >
                {generating === 'region' ? <Loader2Icon className="h-4 w-4 animate-spin mr-1" /> : <PlusIcon className="h-4 w-4 mr-1" />}
                Add Region
              </Button>
              <Button
                variant="outline"
                onClick={() => generateCustomers(5)}
                disabled={generating !== null}
              >
                {generating === 'customers' ? <Loader2Icon className="h-4 w-4 animate-spin mr-1" /> : <PlusIcon className="h-4 w-4 mr-1" />}
                +5 Customers
              </Button>
              <Button
                variant="outline"
                onClick={() => generateCustomers(20)}
                disabled={generating !== null}
              >
                {generating === 'customers' ? <Loader2Icon className="h-4 w-4 animate-spin mr-1" /> : <PlusIcon className="h-4 w-4 mr-1" />}
                +20 Customers
              </Button>
              <Button
                variant="outline"
                onClick={() => generateJobs(5)}
                disabled={generating !== null}
              >
                {generating === 'jobs' ? <Loader2Icon className="h-4 w-4 animate-spin mr-1" /> : <PlusIcon className="h-4 w-4 mr-1" />}
                +5 Jobs
              </Button>
              <Button
                variant="outline"
                onClick={() => generateJobs(20)}
                disabled={generating !== null}
              >
                {generating === 'jobs' ? <Loader2Icon className="h-4 w-4 animate-spin mr-1" /> : <PlusIcon className="h-4 w-4 mr-1" />}
                +20 Jobs
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Data Browser */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="profiles">
              Profiles ({profiles.length})
            </TabsTrigger>
            <TabsTrigger value="regions">
              Regions ({regions.length})
            </TabsTrigger>
            <TabsTrigger value="customers">
              Customers ({customers.length})
            </TabsTrigger>
            <TabsTrigger value="jobs">
              Jobs ({jobs.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profiles">
            <Card>
              <CardContent className="pt-4">
                {profiles.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-4">No profiles found</p>
                ) : (
                  <div className="space-y-2">
                    {profiles.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg text-sm">
                        <div>
                          <span className="font-medium">{p.displayName}</span>
                          <span className="text-muted-foreground ml-2">{p.phone}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={p.role === 'technician' ? 'default' : 'secondary'}>
                            {p.role}
                          </Badge>
                          <code className="text-xs text-muted-foreground">{p.id.slice(0, 8)}</code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => deleteEntity('UserProfile', p.id)}
                          >
                            <Trash2Icon className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="regions">
            <Card>
              <CardContent className="pt-4">
                {regions.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-4">No regions found</p>
                ) : (
                  <div className="space-y-2">
                    {regions.map((r) => (
                      <div key={r.id} className="flex items-center justify-between p-3 border rounded-lg text-sm">
                        <div>
                          <span className="font-medium">{r.name}</span>
                          {r.description && (
                            <span className="text-muted-foreground ml-2">{r.description}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-muted-foreground">{r.id.slice(0, 8)}</code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => deleteEntity('Region', r.id)}
                          >
                            <Trash2Icon className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="customers">
            <Card>
              <CardContent className="pt-4">
                {customers.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-4">No customers found. Search returns by phone — showing all may require a wildcard.</p>
                ) : (
                  <div className="space-y-2">
                    {customers.map((c) => (
                      <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg text-sm">
                        <div className="space-y-0.5">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-muted-foreground">
                            {c.phone} {c.email && `· ${c.email}`}
                          </div>
                          {c.address && (
                            <div className="text-muted-foreground text-xs">{c.address}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-muted-foreground">{c.id.slice(0, 8)}</code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => deleteEntity('Customer', c.id)}
                          >
                            <Trash2Icon className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="jobs">
            <Card>
              <CardContent className="pt-4">
                {jobs.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-4">No jobs found</p>
                ) : (
                  <div className="space-y-2">
                    {jobs.map((j) => (
                      <div key={j.id} className="flex items-center justify-between p-3 border rounded-lg text-sm">
                        <div className="space-y-0.5">
                          <div className="font-medium">{j.title}</div>
                          <div className="text-muted-foreground text-xs">
                            {j.scheduledAt && `Scheduled: ${new Date(j.scheduledAt).toLocaleString()}`}
                            {j.needsHelp && ' · 🚨 Needs Help'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{j.status}</Badge>
                          <code className="text-xs text-muted-foreground">{j.id.slice(0, 8)}</code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => deleteEntity('Job', j.id)}
                          >
                            <Trash2Icon className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
