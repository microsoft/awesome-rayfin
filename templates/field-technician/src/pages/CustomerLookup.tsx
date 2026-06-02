import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  Loader2Icon,
  SearchIcon,
  PlusIcon,
  UserIcon,
} from 'lucide-react';

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
import { Separator } from '@/components/ui/separator';
import { ServiceContainer } from '@/services/ServiceContainer';

import type { Customer } from '../../rayfin/data/Customer';

export function CustomerLookup() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const customerService = ServiceContainer.getInstance().customerService;

  const handleSearch = async () => {
    if (!phone.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const data = await customerService.searchByPhone(phone.trim());
      setResults(data);
    } catch {
      toast.error('Failed to search customers');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center gap-4 px-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          <span className="text-lg font-semibold">Customers</span>
        </div>
      </header>

      <main className="container mx-auto py-6 px-4 max-w-lg space-y-6">
        {/* Search */}
        <Card>
          <CardHeader>
            <CardTitle>Find Customer</CardTitle>
            <CardDescription>Search by phone number</CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <Button onClick={handleSearch} disabled={searching}>
                {searching ? (
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                ) : (
                  <SearchIcon className="h-4 w-4" />
                )}
              </Button>
            </div>

            {searched && results.length === 0 && !searching && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No customers found
              </p>
            )}

            {results.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 p-3 border rounded-lg"
              >
                <UserIcon className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-sm text-muted-foreground">{c.phone}</div>
                  {c.email && (
                    <div className="text-sm text-muted-foreground">{c.email}</div>
                  )}
                </div>
              </div>
            ))}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowCreate(!showCreate)}
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              New Customer
            </Button>
          </CardContent>
        </Card>

        {/* Create Customer */}
        {showCreate && (
          <Card>
            <CardHeader>
              <CardTitle>New Customer</CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              <NewCustomerForm
                initialPhone={phone}
                onCreated={(customer) => {
                  setResults([customer]);
                  setShowCreate(false);
                }}
                onCancel={() => setShowCreate(false)}
              />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
