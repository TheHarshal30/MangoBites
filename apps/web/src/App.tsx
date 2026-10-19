import { useEffect } from 'react';
import { RefreshCw, ServerCrash, WifiOff } from 'lucide-react';
import { AppProvider, useApp } from './lib/app';
import { useRoute, type Route } from './lib/router';
import { ThemeProvider } from './lib/theme';
import { ErrorBoundary, ToastProvider } from './components/overlays';
import { Header } from './components/Header';
import { Button, Card, EmptyState, Skeleton, Spinner } from './components/ui';
import { Playground } from './components/Playground';
import { MatrixView } from './components/MatrixView';
import { HistoryView } from './components/HistoryView';
import { WalletView } from './components/WalletView';

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppProvider>
          <Shell />
        </AppProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

const TITLES: Record<Route['view'], string> = { playground: 'Playground', matrix: 'Interop matrix', history: 'Run history', wallet: 'Wallet' };

function Shell() {
  const route = useRoute();
  const { catalog, catalogError, refreshCatalog } = useApp();

  useEffect(() => {
    if (!(route.view === 'playground' && route.runId)) document.title = `${TITLES[route.view]} · Inji Interop Playground`;
  }, [route.view, route.runId]);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only z-50 rounded-lg bg-surface px-3 py-2 text-sm font-medium shadow-pop focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <Header route={route} />
      <Banners />
      <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
        {!catalog ? (
          catalogError ? (
            <Card>
              <EmptyState icon={ServerCrash} title="Can’t reach the playground API"
                description={<>The UI couldn’t load <code className="font-mono text-xs">/api/catalog</code> ({catalogError}). Make sure the server is running — <code className="font-mono text-xs">./scripts/up.sh</code> starts everything.</>}
                action={<Button icon={RefreshCw} onClick={() => refreshCatalog()}>Try again</Button>} />
            </Card>
          ) : <LoadingSkeleton />
        ) : (
          <ErrorBoundary resetKey={`${route.view}/${route.runId ?? ''}`}>
            {route.view === 'playground' && <Playground runId={route.runId} />}
            {route.view === 'matrix' && <MatrixView />}
            {route.view === 'history' && <HistoryView />}
            {route.view === 'wallet' && <WalletView />}
          </ErrorBoundary>
        )}
      </main>
      <Footer />
    </div>
  );
}

function Banners() {
  const { catalog, catalogError, connection, refreshCatalog } = useApp();
  if (!catalog) return null;
  if (catalogError) {
    return (
      <div role="alert" className="border-b border-line bg-danger-soft text-danger-fg">
        <div className="mx-auto flex max-w-[1600px] items-center gap-2.5 px-4 py-2 text-[13px] sm:px-6">
          <ServerCrash size={15} aria-hidden />
          <span className="min-w-0 flex-1 truncate">Lost contact with the playground API — showing the last known state.</span>
          <Button size="xs" variant="ghost" icon={RefreshCw} onClick={() => refreshCatalog()} className="text-danger-fg">Retry</Button>
        </div>
      </div>
    );
  }
  if (connection === 'closed') {
    return (
      <div role="status" className="border-b border-line bg-warning-soft text-warning-fg">
        <div className="mx-auto flex max-w-[1600px] items-center gap-2.5 px-4 py-2 text-[13px] sm:px-6">
          <WifiOff size={15} aria-hidden />
          <span className="min-w-0 flex-1 truncate">Live updates paused — reconnecting to the playground server…</span>
          <Spinner size={14} />
        </div>
      </div>
    );
  }
  return null;
}

function Footer() {
  const { catalog } = useApp();
  const v = (id: string) => catalog?.parties.find((p) => p.id === id)?.version;
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-xs text-fg-subtle sm:px-6">
        <span>Inji Interop Playground</span>
        {catalog && <span>Inji Certify {v('inji-certify')} · Inji Verify {v('inji-verify')}</span>}
        <span className="sm:ml-auto">OpenID4VCI draft 13 · OpenID4VP draft 21 · W3C VC · SD-JWT VC · ISO 18013-5</span>
      </div>
    </footer>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <Card className="p-5">
        <Skeleton className="h-4 w-40" />
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-[76px] w-full" />
              <Skeleton className="h-[76px] w-full" />
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-5"><Skeleton className="h-40 w-full" /></Card>
    </div>
  );
}
