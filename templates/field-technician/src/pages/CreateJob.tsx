import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeftIcon, SearchIcon, PlusIcon, Loader2Icon } from 'lucide-react';

import { NewCustomerForm } from '@/components/NewCustomerForm';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ServiceContainer } from '@/services/ServiceContainer';
import { useRegions } from '@/hooks/useRegions';

import type { Customer } from '../../rayfin/data/Customer';
import type { UserProfile } from '../../rayfin/data/UserProfile';

export function CreateJob() {
  const navigate = useNavigate();
  const { regions, myRegionIds } = useRegions();
  const customerService = ServiceContainer.getInstance().customerService;
  const jobService = ServiceContainer.getInstance().jobService;
  const userProfileService = ServiceContainer.getInstance().userProfileService;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [regionId, setRegionId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [technicians, setTechnicians] = useState<UserProfile[]>([]);

  // Default region to the dispatcher's first assigned region
  useEffect(() => {
    if (!regionId && myRegionIds.length > 0) {
      setRegionId(myRegionIds[0]);
    }
  }, [regionId, myRegionIds]);

  // Fetch technicians for assignment
  useEffect(() => {
    userProfileService.getProfilesByRole('technician').then(setTechnicians).catch((err) => {
      console.error('Failed to fetch technicians:', err);
    });
  }, [userProfileService]);

  // Customer lookup
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [searching, setSearching] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const handleCustomerSearch = async () => {
    if (!customerPhone.trim()) return;
    setSearching(true);
    try {
      const results = await customerService.searchByPhone(customerPhone.trim());
      setCustomerResults(results);
      if (results.length === 0) {
        setShowNewCustomer(true);
      }
    } catch {
      toast.error('Failed to search customers');
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || !selectedCustomer || !regionId) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    try {
      await jobService.createJob({
        title: title.trim(),
        description: description.trim() || undefined,
        customerId: selectedCustomer.id,
        regionId,
        technicianId: (technicianId && technicianId !== 'none') ? technicianId : undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      });
      toast.success('Job created!');
      navigate('/dispatcher');
    } catch {
      toast.error('Failed to create job');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center gap-4 px-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          <span className="text-lg font-semibold">New Job</span>
        </div>
      </header>

      <main className="container mx-auto py-6 px-4 max-w-lg space-y-6">
        {/* Customer */}
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
            <CardDescription>
              Search by phone number or create a new customer
            </CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            {selectedCustomer ? (
              <div className="flex items-center justify-between p-3 border rounded-lg bg-accent/30">
                <div>
                  <div className="font-medium">{selectedCustomer.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedCustomer.phone}
                  </div>
                  {selectedCustomer.email && (
                    <div className="text-sm text-muted-foreground">
                      {selectedCustomer.email}
                    </div>
                  )}
                  {selectedCustomer.address && (
                    <div className="text-sm text-muted-foreground">
                      {selectedCustomer.address}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedCustomer(null)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    placeholder="Customer phone number"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCustomerSearch()}
                  />
                  <Button onClick={handleCustomerSearch} disabled={searching}>
                    {searching ? (
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                    ) : (
                      <SearchIcon className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {customerResults.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-accent/50"
                    onClick={() => setSelectedCustomer(c)}
                  >
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-sm text-muted-foreground">{c.phone}</div>
                    </div>
                  </div>
                ))}
                {showNewCustomer ? (
                  <div className="border rounded-lg p-3">
                    <NewCustomerForm
                      initialPhone={customerPhone}
                      onCreated={(customer) => {
                        setSelectedCustomer(customer);
                        setShowNewCustomer(false);
                      }}
                      onCancel={() => setShowNewCustomer(false)}
                    />
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowNewCustomer(true)}
                  >
                    <PlusIcon className="h-4 w-4 mr-2" />
                    New Customer
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Job Details */}
        <Card>
          <CardHeader>
            <CardTitle>Job Details</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-1">
              <Label>Title *</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Job title"
              />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Job description (optional)"
                rows={3}
              />
            </div>
            <div className="space-y-1">
              <Label>Region *</Label>
              <Select value={regionId} onValueChange={setRegionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a region" />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Schedule (optional)</Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Assign Technician (optional)</Label>
              <Select value={technicianId} onValueChange={setTechnicianId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {technicians.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Button
          className="w-full"
          size="lg"
          onClick={handleSubmit}
          disabled={submitting || !title.trim() || !selectedCustomer || !regionId}
        >
          {submitting ? 'Creating...' : 'Create Job'}
        </Button>
      </main>
    </div>
  );
}
