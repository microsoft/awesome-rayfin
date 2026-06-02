import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ServiceContainer } from '@/services/ServiceContainer';

import type { Customer } from '../../rayfin/data/Customer';

interface NewCustomerFormProps {
  /** Pre-fill the phone field (e.g. from a search query) */
  initialPhone?: string;
  /** Called after the customer is successfully created */
  onCreated: (customer: Customer) => void;
  /** Called when the user cancels */
  onCancel?: () => void;
}

export function NewCustomerForm({
  initialPhone = '',
  onCreated,
  onCancel,
}: NewCustomerFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [creating, setCreating] = useState(false);

  const customerService = ServiceContainer.getInstance().customerService;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toast.error('Name and phone are required');
      return;
    }

    setCreating(true);
    try {
      const customer = await customerService.createCustomer({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        address: address.trim() || undefined,
      });
      toast.success('Customer created!');
      onCreated(customer);
    } catch {
      toast.error('Failed to create customer');
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="customer-name">Name *</Label>
        <Input
          id="customer-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Customer name"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="customer-phone">Phone *</Label>
        <Input
          id="customer-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone number"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="customer-email">Email</Label>
        <Input
          id="customer-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (optional)"
          type="email"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="customer-address">Address</Label>
        <Input
          id="customer-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address (optional)"
        />
      </div>
      <div className="flex gap-2">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          className="flex-1"
          disabled={creating || !name.trim() || !phone.trim()}
        >
          {creating ? 'Creating...' : 'Create Customer'}
        </Button>
      </div>
    </form>
  );
}
