import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ClipboardListIcon,
  LogOutIcon,
  RefreshCwIcon,
  AlertTriangleIcon,
  Loader2Icon,
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
import { useAuth } from '@/hooks/AuthContext';
import { useTechnicianJobs } from '@/hooks/useJobs';
import { useUserProfile } from '@/hooks/useUserProfile';

import type { Job } from '../../rayfin/data/Job';

function statusBadgeVariant(status: Job['status']) {
  switch (status) {
    case 'new':
      return 'secondary';
    case 'scheduled':
      return 'outline';
    case 'investigating':
    case 'in-progress':
      return 'default';
    case 'blocked':
      return 'destructive';
    case 'complete':
      return 'secondary';
    case 'abandoned':
      return 'secondary';
    default:
      return 'secondary';
  }
}

export function TechnicianDashboard() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { profile } = useUserProfile();
  const { jobs, loading, error, refresh } = useTechnicianJobs(profile?.id);

  const scheduledJobs = jobs
    .filter((j) => j.scheduledAt && !['complete', 'abandoned'].includes(j.status))
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());

  const unscheduledJobs = jobs
    .filter((j) => !j.scheduledAt && !['complete', 'abandoned'].includes(j.status))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const completedJobs = jobs
    .filter((j) => ['complete', 'abandoned'].includes(j.status))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <ClipboardListIcon className="h-6 w-6" />
            <span className="text-lg font-semibold">My Jobs</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {profile?.displayName || user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              <LogOutIcon className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto py-6 px-4 space-y-6">
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>

        {error && (
          <div className="text-destructive text-sm">{error}</div>
        )}

        {/* Scheduled Jobs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Scheduled Jobs</CardTitle>
            <CardDescription>Upcoming jobs in chronological order</CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            {scheduledJobs.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">
                No scheduled jobs
              </p>
            ) : (
              <div className="space-y-3">
                {scheduledJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => navigate(`/technician/jobs/${job.id}`)}
                  >
                    <div className="space-y-1">
                      <div className="font-medium">{job.title}</div>
                      <div className="text-sm text-muted-foreground">
                        {job.scheduledAt &&
                          format(new Date(job.scheduledAt), 'MMM d, yyyy h:mm a')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {job.needsHelp && (
                        <AlertTriangleIcon className="h-4 w-4 text-amber-500" />
                      )}
                      <Badge variant={statusBadgeVariant(job.status)}>
                        {job.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Unscheduled Jobs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Unscheduled Jobs</CardTitle>
            <CardDescription>Jobs without a scheduled time</CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            {unscheduledJobs.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">
                No unscheduled jobs
              </p>
            ) : (
              <div className="space-y-3">
                {unscheduledJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => navigate(`/technician/jobs/${job.id}`)}
                  >
                    <div className="space-y-1">
                      <div className="font-medium">{job.title}</div>
                      <div className="text-sm text-muted-foreground">
                        Updated {format(new Date(job.updatedAt), 'MMM d h:mm a')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {job.needsHelp && (
                        <AlertTriangleIcon className="h-4 w-4 text-amber-500" />
                      )}
                      <Badge variant={statusBadgeVariant(job.status)}>
                        {job.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Completed Jobs */}
        {completedJobs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Completed</CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              <div className="space-y-3">
                {completedJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors opacity-60"
                    onClick={() => navigate(`/technician/jobs/${job.id}`)}
                  >
                    <div className="font-medium">{job.title}</div>
                    <Badge variant="secondary">{job.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
