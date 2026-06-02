import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  LayoutDashboardIcon,
  LogOutIcon,
  PlusIcon,
  RefreshCwIcon,
  AlertTriangleIcon,
  ClockIcon,
  PlayIcon,
  InboxIcon,
  Loader2Icon,
  UsersIcon,
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
import { useDispatcherJobs } from '@/hooks/useJobs';
import { useUserProfile } from '@/hooks/useUserProfile';

import type { Job } from '../../rayfin/data/Job';

function JobListItem({
  job,
  onClick,
}: {
  job: Job;
  onClick: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={onClick}
    >
      <div className="space-y-1 min-w-0 flex-1">
        <div className="font-medium truncate">{job.title}</div>
        <div className="text-sm text-muted-foreground">
          {job.scheduledAt
            ? `Scheduled: ${format(new Date(job.scheduledAt), 'MMM d, h:mm a')}`
            : job.createdAt
              ? `Created: ${format(new Date(job.createdAt), 'MMM d, h:mm a')}`
              : job.updatedAt
                ? `Updated: ${format(new Date(job.updatedAt), 'MMM d, h:mm a')}`
                : ''}
        </div>
      </div>
      <div className="flex items-center gap-2 ml-2">
        {job.needsHelp && (
          <AlertTriangleIcon className="h-4 w-4 text-amber-500" />
        )}
        <Badge variant="secondary">{job.status}</Badge>
      </div>
    </div>
  );
}

export function DispatcherDashboard() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { profile } = useUserProfile();
  const {
    unscheduled,
    inProgress,
    overdue,
    helpRequests,
    loading,
    error,
    refresh,
  } = useDispatcherJobs();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <LayoutDashboardIcon className="h-6 w-6" />
            <span className="text-lg font-semibold">Dispatch Center</span>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/dispatcher/customers')}
            >
              <UsersIcon className="mr-2 h-4 w-4" />
              Customers
            </Button>
            <Button size="sm" onClick={() => navigate('/dispatcher/jobs/new')}>
              <PlusIcon className="mr-2 h-4 w-4" />
              New Job
            </Button>
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

        {error && <div className="text-destructive text-sm">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Help Requests */}
          <Card className="border-amber-200">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangleIcon className="h-5 w-5 text-amber-500" />
                <CardTitle className="text-lg">Help Requests</CardTitle>
              </div>
              <CardDescription>
                Technicians requesting assistance
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              {helpRequests.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4 text-center">
                  No help requests
                </p>
              ) : (
                <div className="space-y-3">
                  {helpRequests.map((job) => (
                    <div key={job.id}>
                      <JobListItem
                        job={job}
                        onClick={() => navigate(`/dispatcher/jobs/${job.id}`)}
                      />
                      {job.helpDescription && (
                        <p className="text-sm text-amber-700 mt-1 ml-3 italic">
                          "{job.helpDescription}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Overdue Scheduled */}
          <Card className="border-red-200">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ClockIcon className="h-5 w-5 text-red-500" />
                <CardTitle className="text-lg">Overdue</CardTitle>
              </div>
              <CardDescription>
                Scheduled jobs past their start time
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              {overdue.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4 text-center">
                  No overdue jobs
                </p>
              ) : (
                <div className="space-y-3">
                  {overdue.map((job) => (
                    <JobListItem
                      key={job.id}
                      job={job}
                      onClick={() => navigate(`/dispatcher/jobs/${job.id}`)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Unscheduled */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <InboxIcon className="h-5 w-5" />
                <CardTitle className="text-lg">Unscheduled</CardTitle>
              </div>
              <CardDescription>New jobs needing scheduling</CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              {unscheduled.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4 text-center">
                  No unscheduled jobs
                </p>
              ) : (
                <div className="space-y-3">
                  {unscheduled.map((job) => (
                    <JobListItem
                      key={job.id}
                      job={job}
                      onClick={() => navigate(`/dispatcher/jobs/${job.id}`)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* In Progress */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <PlayIcon className="h-5 w-5" />
                <CardTitle className="text-lg">In Progress</CardTitle>
              </div>
              <CardDescription>Currently active jobs</CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              {inProgress.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4 text-center">
                  No jobs in progress
                </p>
              ) : (
                <div className="space-y-3">
                  {inProgress.map((job) => (
                    <JobListItem
                      key={job.id}
                      job={job}
                      onClick={() => navigate(`/dispatcher/jobs/${job.id}`)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
