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
            Componentes Shadcn/UI + variantes do SIGOP. Rota de teste — pode apagar depois.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Botões</CardTitle>
            <CardDescription>Variantes do Shadcn + <code>primary</code> e <code>sidebar</code></CardDescription>
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
              <Button variant="sidebar">Outra ação</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Badges — status operacional</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="aberta">Aberta</Badge>
            <Badge variant="em_andamento">Em andamento</Badge>
            <Badge variant="encerrada">Encerrada</Badge>
            <Badge variant="arquivada">Arquivada</Badge>
            <Badge variant="flagrante">Flagrante</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Badges — sincronização</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="rascunho">Rascunho</Badge>
            <Badge variant="pendente">Pendente</Badge>
            <Badge variant="sincronizando">Sincronizando</Badge>
            <Badge variant="sincronizado">Sincronizado</Badge>
            <Badge variant="erro">Erro</Badge>
            <Badge variant="conflito">Conflito</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Formulário, Tabs, Dialog e Toast</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="form">
              <TabsList>
                <TabsTrigger value="form">Formulário</TabsTrigger>
                <TabsTrigger value="acoes">Ações</TabsTrigger>
              </TabsList>
              <TabsContent value="form" className="space-y-3 pt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="reg">Nº de registro</Label>
                  <Input id="reg" placeholder="2026-000123" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="resp">Responsável</Label>
                  <Input id="resp" placeholder="Nome do agente" />
                </div>
              </TabsContent>
              <TabsContent value="acoes" className="flex flex-wrap gap-3 pt-4">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="primary">Abrir dialog</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Encerrar ocorrência</DialogTitle>
                      <DialogDescription>
                        Confirma o encerramento? Essa ação pode ser revertida por um supervisor.
                      </DialogDescription>
                    </DialogHeader>
                  </DialogContent>
                </Dialog>
                <Button
                  variant="outline"
                  onClick={() =>
                    toast({
                      title: "Sincronizado",
                      description: "3 ocorrências enviadas ao servidor.",
                    })
                  }
                >
                  Disparar toast
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
