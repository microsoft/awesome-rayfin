import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  HardHatIcon,
  HeadphonesIcon,
  MapPinIcon,
  PlusIcon,
} from 'lucide-react';

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
import { useUserProfile } from '@/hooks/useUserProfile';
import { useRegions } from '@/hooks/useRegions';

export function ProfileSetup() {
  const navigate = useNavigate();
  const { createProfile } = useUserProfile();
  const { regions, createRegion, assignRegion } = useRegions();

  const [step, setStep] = useState<'role' | 'region'>('role');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedRole, setSelectedRole] = useState<
    'technician' | 'dispatcher' | null
  >(null);
  const [newRegionName, setNewRegionName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRoleSelect = async (role: 'technician' | 'dispatcher') => {
    if (!displayName.trim()) {
      toast.error('Please enter your name');
      return;
    }
    setSelectedRole(role);
    setIsSubmitting(true);
    try {
      await createProfile({ displayName: displayName.trim(), role, phone: phone.trim() || undefined });
      toast.success('Profile created!');
      setStep('region');
    } catch {
      toast.error('Failed to create profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssignRegion = async (regionId: string) => {
    setIsSubmitting(true);
    try {
      await assignRegion(regionId);
      toast.success('Region assigned!');
      navigate(selectedRole === 'technician' ? '/technician' : '/dispatcher');
    } catch {
      toast.error('Failed to assign region');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateRegion = async () => {
    if (!newRegionName.trim()) return;
    setIsSubmitting(true);
    try {
      const region = await createRegion(newRegionName.trim());
      await assignRegion(region.id);
      toast.success('Region created and assigned!');
      navigate(selectedRole === 'technician' ? '/technician' : '/dispatcher');
    } catch {
      toast.error('Failed to create region');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === 'role') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Welcome!</CardTitle>
              <CardDescription>
                Set up your profile to get started
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayName">Your Name</Label>
                <Input
                  id="displayName"
                  placeholder="Enter your name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone (optional)</Label>
                <Input
                  id="phone"
                  placeholder="Enter your phone number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Choose your role</Label>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="h-24 flex-col gap-2"
                    onClick={() => handleRoleSelect('technician')}
                    disabled={isSubmitting}
                  >
                    <HardHatIcon className="h-8 w-8" />
                    <span>Technician</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-24 flex-col gap-2"
                    onClick={() => handleRoleSelect('dispatcher')}
                    disabled={isSubmitting}
                  >
                    <HeadphonesIcon className="h-8 w-8" />
                    <span>Dispatcher</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <Card>
          <CardHeader className="text-center">
            <MapPinIcon className="h-8 w-8 mx-auto mb-2" />
            <CardTitle>Choose Your Region</CardTitle>
            <CardDescription>
              Select an existing region or create a new one
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {regions.length > 0 && (
              <div className="space-y-2">
                {regions.map((region) => (
                  <Button
                    key={region.id}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => handleAssignRegion(region.id)}
                    disabled={isSubmitting}
                  >
                    <MapPinIcon className="mr-2 h-4 w-4" />
                    {region.name}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                placeholder="New region name"
                value={newRegionName}
                onChange={(e) => setNewRegionName(e.target.value)}
              />
              <Button
                onClick={handleCreateRegion}
                disabled={isSubmitting || !newRegionName.trim()}
              >
                <PlusIcon className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
