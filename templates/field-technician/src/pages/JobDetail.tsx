import { useParams, useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  CameraIcon,
  ImageIcon,
  Loader2Icon,
  MapPinIcon,
  PlusIcon,
  SendIcon,
  WrenchIcon,
  AlertTriangleIcon,
  CalendarIcon,
  Trash2Icon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CameraCapture } from '@/components/CameraCapture';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useJobDetail } from '@/hooks/useJobs';

import type { JobStatus } from '../../rayfin/data/Job';

const JOB_STATUSES: JobStatus[] = [
  'new',
  'scheduled',
  'investigating',
  'in-progress',
  'blocked',
  'complete',
  'abandoned',
];

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    job,
    customer,
    equipment,
    taskItems,
    logs,
    loading,
    error,
    refresh,
    updateStatus,
    scheduleJob,
    toggleOnSite,
    requestHelp,
    clearHelp,
    addEquipment,
    addTaskItem,
    toggleTask,
    addLog,
  } = useJobDetail(id!);

  // Form states
  const [newEquipmentName, setNewEquipmentName] = useState('');
  const [newEquipmentSerial, setNewEquipmentSerial] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [logMessage, setLogMessage] = useState('');
  const [logImageUrl, setLogImageUrl] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [helpDesc, setHelpDesc] = useState('');
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleInput, setScheduleInput] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2Icon className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive">{error || 'Job not found'}</p>
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  const handleStatusChange = async (status: string) => {
    try {
      await updateStatus(status as JobStatus);
      toast.success(`Status updated to ${status}`);
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleScheduleSave = async () => {
    setSubmitting('schedule');
    try {
      const date = scheduleInput ? new Date(scheduleInput) : null;
      await scheduleJob(date);
      setEditingSchedule(false);
      toast.success(date ? 'Job scheduled' : 'Schedule removed');
    } catch {
      toast.error('Failed to update schedule');
    } finally {
      setSubmitting(null);
    }
  };

  const handleAddEquipment = async () => {
    if (!newEquipmentName.trim()) return;
    setSubmitting('equipment');
    try {
      await addEquipment({
        name: newEquipmentName.trim(),
        serialNumber: newEquipmentSerial.trim() || undefined,
      });
      setNewEquipmentName('');
      setNewEquipmentSerial('');
      toast.success('Equipment added');
    } catch {
      toast.error('Failed to add equipment');
    } finally {
      setSubmitting(null);
    }
  };

  const handleAddTask = async () => {
    if (!newTaskDesc.trim()) return;
    setSubmitting('task');
    try {
      await addTaskItem({
        description: newTaskDesc.trim(),
        sortOrder: taskItems.length,
      });
      setNewTaskDesc('');
      toast.success('Task added');
    } catch {
      toast.error('Failed to add task');
    } finally {
      setSubmitting(null);
    }
  };

  const handleToggleTask = async (taskId: string, isComplete: boolean) => {
    try {
      await toggleTask(taskId, isComplete);
    } catch {
      toast.error('Failed to update task');
    }
  };

  const handleAddLog = async () => {
    if (!logMessage.trim()) return;
    setSubmitting('log');
    try {
      await addLog({
        type: 'note',
        message: logMessage.trim(),
        imageUrl: logImageUrl.trim() || undefined,
      });
      setLogMessage('');
      setLogImageUrl('');
      toast.success('Log entry added');
    } catch {
      toast.error('Failed to add log');
    } finally {
      setSubmitting(null);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setLogImageUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleRequestHelp = async () => {
    if (!helpDesc.trim()) return;
    setSubmitting('help');
    try {
      await requestHelp(helpDesc.trim());
      await addLog({ type: 'help_request', message: `Help requested: ${helpDesc.trim()}` });
      setHelpDesc('');
      toast.success('Help request sent');
    } catch {
      toast.error('Failed to send help request');
    } finally {
      setSubmitting(null);
    }
  };

  const completedTasks = taskItems.filter((t) => t.isComplete).length;
  const totalTasks = taskItems.length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center gap-4 px-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">{job.title}</h1>
            {customer?.name && (
              <p className="text-sm text-muted-foreground truncate">
                {customer.name}
              </p>
            )}
          </div>
          <Badge>{job.status}</Badge>
        </div>
      </header>

      <main className="container mx-auto py-6 px-4 space-y-6 max-w-3xl">
        {/* Status & Controls */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={job.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={job.isOnSite}
                  onCheckedChange={(checked) => toggleOnSite(checked)}
                />
                <Label className="flex items-center gap-1">
                  <MapPinIcon className="h-4 w-4" />
                  On-Site
                </Label>
              </div>
            </div>

            {job.description && (
              <p className="text-sm text-muted-foreground">{job.description}</p>
            )}

            {/* Schedule */}
            <div className="space-y-2">
              {editingSchedule ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={scheduleInput}
                    onChange={(e) => setScheduleInput(e.target.value)}
                    className="w-auto"
                  />
                  <Button
                    size="sm"
                    onClick={handleScheduleSave}
                    disabled={submitting === 'schedule'}
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingSchedule(false)}
                  >
                    Cancel
                  </Button>
                  {job.scheduledAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => {
                        setScheduleInput('');
                        handleScheduleSave();
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ) : job.scheduledAt ? (
                <div className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    <strong>Scheduled:</strong>{' '}
                    {format(new Date(job.scheduledAt), 'MMM d, yyyy h:mm a')}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const d = new Date(job.scheduledAt!);
                      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                        .toISOString()
                        .slice(0, 16);
                      setScheduleInput(local);
                      setEditingSchedule(true);
                    }}
                  >
                    Edit
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setScheduleInput('');
                    setEditingSchedule(true);
                  }}
                >
                  <CalendarIcon className="h-4 w-4 mr-1" />
                  Add to Schedule
                </Button>
              )}
            </div>

            {/* Help Request */}
            {job.needsHelp ? (
              <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-amber-800">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <span className="font-medium">Help Requested</span>
                </div>
                {job.helpDescription && (
                  <p className="text-sm text-amber-700">{job.helpDescription}</p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={submitting === 'clearHelp'}
                  onClick={async () => {
                    setSubmitting('clearHelp');
                    try {
                      await clearHelp();
                      await refresh();
                      toast.success('Help request cleared');
                    } catch {
                      toast.error('Failed to clear help request');
                    } finally {
                      setSubmitting(null);
                    }
                  }}
                >
                  Clear Help Request
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Describe what help you need..."
                    value={helpDesc}
                    onChange={(e) => setHelpDesc(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    onClick={handleRequestHelp}
                    disabled={submitting === 'help' || !helpDesc.trim()}
                  >
                    <AlertTriangleIcon className="h-4 w-4 mr-1" />
                    Request Help
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Task Checklist */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                Task Checklist
                {totalTasks > 0 && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({completedTasks}/{totalTasks})
                  </span>
                )}
              </CardTitle>
            </div>
            <CardDescription>
              Review with customer before starting maintenance
            </CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            {taskItems.map((task) => (
              <div key={task.id} className="flex items-center gap-3">
                <Checkbox
                  checked={task.isComplete}
                  onCheckedChange={(checked) =>
                    handleToggleTask(task.id, checked === true)
                  }
                />
                <span
                  className={
                    task.isComplete ? 'line-through text-muted-foreground' : ''
                  }
                >
                  {task.description}
                </span>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Input
                placeholder="Add a task..."
                value={newTaskDesc}
                onChange={(e) => setNewTaskDesc(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
              />
              <Button
                variant="outline"
                onClick={handleAddTask}
                disabled={submitting === 'task' || !newTaskDesc.trim()}
              >
                <PlusIcon className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Equipment */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <WrenchIcon className="h-5 w-5" />
              Equipment
            </CardTitle>
            <CardDescription>Equipment being serviced on this job</CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            {equipment.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div>
                  <div className="font-medium">{item.name}</div>
                  {item.serialNumber && (
                    <div className="text-sm text-muted-foreground">
                      S/N: {item.serialNumber}
                    </div>
                  )}
                  {item.notes && (
                    <div className="text-sm text-muted-foreground mt-1">
                      {item.notes}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div className="space-y-2 pt-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Equipment name"
                  value={newEquipmentName}
                  onChange={(e) => setNewEquipmentName(e.target.value)}
                />
                <Input
                  placeholder="Serial # (optional)"
                  value={newEquipmentSerial}
                  onChange={(e) => setNewEquipmentSerial(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={handleAddEquipment}
                  disabled={submitting === 'equipment' || !newEquipmentName.trim()}
                >
                  <PlusIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Job Log */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Job Log</CardTitle>
            <CardDescription>Notes, updates, and photos</CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            {/* Add log entry */}
            <div className="space-y-2 border rounded-lg p-3">
              <Textarea
                placeholder="Write a note..."
                value={logMessage}
                onChange={(e) => setLogMessage(e.target.value)}
                rows={2}
              />
              {logImageUrl && (
                <div className="relative inline-block">
                  <img
                    src={logImageUrl}
                    alt="Upload preview"
                    className="h-20 w-20 object-cover rounded border"
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full"
                    onClick={() => setLogImageUrl('')}
                  >
                    <Trash2Icon className="h-3 w-3" />
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon className="h-4 w-4 mr-1" />
                  Upload
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCamera(true)}
                >
                  <CameraIcon className="h-4 w-4 mr-1" />
                  Camera
                </Button>
                <div className="flex-1" />
                <Button
                  size="sm"
                  onClick={handleAddLog}
                  disabled={submitting === 'log' || !logMessage.trim()}
                >
                  <SendIcon className="h-4 w-4 mr-1" />
                  Add Entry
                </Button>
              </div>
              {showCamera && (
                <CameraCapture
                  onCapture={(dataUrl) => {
                    setLogImageUrl(dataUrl);
                    setShowCamera(false);
                  }}
                  onClose={() => setShowCamera(false)}
                />
              )}
            </div>

            {/* Log entries */}
            {logs.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">
                No log entries yet
              </p>
            ) : (
              <div className="space-y-3">
                {logs.map((log) => (
                  <div key={log.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-xs">
                        {log.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(log.createdAt), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    <p className="text-sm">{log.message}</p>
                    {log.imageUrl && (
                      <img
                        src={log.imageUrl}
                        alt="Log attachment"
                        className="max-h-48 rounded border"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
