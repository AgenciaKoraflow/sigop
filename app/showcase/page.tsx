"use client"

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
  useToast,
} from "@/components/ui"

export default function ShowcasePage() {
  const { toast } = useToast()

  return (
    <div className="min-h-screen bg-content-bg p-8">
      <div className="mx-auto max-w-4xl space-y-10">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-ink">SIGOP · Design System</h1>
          <p className="text-sm text-ink-secondary">
            Shadcn/UI components + SIGOP variants. Test route — safe to delete later.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Buttons</CardTitle>
            <CardDescription>Shadcn variants + <code>primary</code> and <code>sidebar</code></CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary (brand)</Button>
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <div className="flex w-full gap-3 rounded-icon bg-sidebar p-3">
              <Button variant="sidebar">Sidebar item</Button>
              <Button variant="sidebar">Another action</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Badges — operational status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="open">Open</Badge>
            <Badge variant="in_progress">In progress</Badge>
            <Badge variant="closed">Closed</Badge>
            <Badge variant="archived">Archived</Badge>
            <Badge variant="in_flagrante">In flagrante</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Badges — sync status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="draft">Draft</Badge>
            <Badge variant="pending">Pending</Badge>
            <Badge variant="syncing">Syncing</Badge>
            <Badge variant="synced">Synced</Badge>
            <Badge variant="error">Error</Badge>
            <Badge variant="conflict">Conflict</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Form, Tabs, Dialog and Toast</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="form">
              <TabsList>
                <TabsTrigger value="form">Form</TabsTrigger>
                <TabsTrigger value="actions">Actions</TabsTrigger>
              </TabsList>
              <TabsContent value="form" className="space-y-3 pt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="record-number">Record number</Label>
                  <Input id="record-number" placeholder="2026-000123" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="assignee">Assignee</Label>
                  <Input id="assignee" placeholder="Agent name" />
                </div>
              </TabsContent>
              <TabsContent value="actions" className="flex flex-wrap gap-3 pt-4">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="primary">Open dialog</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Close incident</DialogTitle>
                      <DialogDescription>
                        Confirm closing this incident? A supervisor can revert this action.
                      </DialogDescription>
                    </DialogHeader>
                  </DialogContent>
                </Dialog>
                <Button
                  variant="outline"
                  onClick={() =>
                    toast({
                      title: "Synced",
                      description: "3 incidents sent to the server.",
                    })
                  }
                >
                  Trigger toast
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      <Toaster />
    </div>
  )
}
