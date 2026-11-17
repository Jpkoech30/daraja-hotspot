import { useCallback, useEffect, useMemo, useState } from 'react';

const API_URL = '/api/admin';

const navigation = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'plans', label: 'Bundles', icon: 'layers' },
  { id: 'routers', label: 'Routers', icon: 'router' },
  { id: 'payments', label: 'M-Pesa settings', icon: 'shield' }
];

const routerSetupStages = [
  ['discovery-started', 'Bootstrap received'],
  ['dhcp-client-scan-complete', 'DHCP WAN scan complete'],
  ['default-route-scan-started', 'Scanning active default routes'],
  ['default-route-scan-complete', 'Default-route scan complete'],
  ['bridge-scan-complete', 'Bridge scan complete'],
  ['ethernet-scan-complete', 'Ethernet scan complete'],
  ['lan-interface-selected', 'Customer LAN interface selected'],
  ['gateway-selected', 'Customer gateway selected'],
  ['lan-detected', 'Customer LAN detected'],
  ['install-download-started', 'Downloading installer'],
  ['install-file-downloaded', 'Installer file downloaded'],
  ['install-import-started', 'Importing installer'],
  ['installer-started', 'Installer started'],
  ['heartbeat-install-started', 'Installing heartbeat'],
  ['heartbeat-installed', 'Heartbeat installed'],
  ['hotspot-configured', 'Hotspot configured'],
  ['gateway-registered', 'Gateway registered'],
  ['poller-install-started', 'Installing agent poller'],
  ['poller-installed', 'Agent poller installed'],
  ['complete', 'Setup complete']
];

const iconPaths = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  router: <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M7 8V5m10 3V5M7 14h.01M11 14h.01M15 14h.01M7 17h10" /></>,
  shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
  arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8m-9 4h4" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" /></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  close: <><path d="m18 6-12 12M6 6l12 12" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" /></>,
  wifi: <><path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" /></>
};

function Icon({ name, size = 18 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {iconPaths[name]}
    </svg>
  );
}

async function request(path, { token, ...options } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function formatKes(value) {
  return `KES ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('adminToken'));
  const [tenant, setTenant] = useState(() => {
    try { return JSON.parse(localStorage.getItem('adminTenant') || 'null'); } catch { return null; }
  });
  const [page, setPage] = useState('overview');
  const [authMode, setAuthMode] = useState('login');
  const [authValues, setAuthValues] = useState({ name: '', email: '', password: '', code: '' });
  const [authNotice, setAuthNotice] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [overview, setOverview] = useState(null);
  const [periodDays, setPeriodDays] = useState(30);
  const [plans, setPlans] = useState([]);
  const [routers, setRouters] = useState([]);
  const [mpesa, setMpesa] = useState({ configured: false, mpesa_shortcode: '' });
  const [mpesaForm, setMpesaForm] = useState({ shortcode: '', consumerKey: '', consumerSecret: '', passkey: '' });
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [generatedScript, setGeneratedScript] = useState('');
  const [scriptCopied, setScriptCopied] = useState(false);
  const [routerCheckError, setRouterCheckError] = useState('');
  const [heartbeatUpdatedAt, setHeartbeatUpdatedAt] = useState(null);
  const [heartbeatRefreshing, setHeartbeatRefreshing] = useState(false);

  const notify = useCallback((message, type = 'success') => {
    setNotice({ message, type });
    window.setTimeout(() => setNotice(null), 4500);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminTenant');
    setAuthToken(null);
    setTenant(null);
    setOverview(null);
    setPlans([]);
    setRouters([]);
  }, []);

  const loadWorkspace = useCallback(async (activeToken, days = 30) => {
    try {
      const [overviewResponse, plansResponse, routersResponse, mpesaResponse] = await Promise.all([
        request(`/overview?days=${days}`, { token: activeToken }),
        request('/plans', { token: activeToken }),
        request('/routers', { token: activeToken }),
        request('/settings/mpesa', { token: activeToken })
      ]);
      setOverview(overviewResponse.data);
      setPlans(plansResponse.data);
      setRouters(routersResponse.data);
      setMpesa(mpesaResponse.data);
      setMpesaForm((current) => ({ ...current, shortcode: mpesaResponse.data.mpesa_shortcode || '' }));
      setHeartbeatUpdatedAt(new Date().toISOString());
    } catch (error) {
      if (/unauthorized|invalid token|token expired/i.test(error.message)) logout();
      else notify(error.message, 'error');
    }
  }, [logout, notify]);

  useEffect(() => {
    if (authToken) loadWorkspace(authToken, periodDays);
  }, [authToken, loadWorkspace, periodDays]);

  const refreshHeartbeatStats = useCallback(async (activeToken, days) => {
    const [overviewResponse, routersResponse] = await Promise.all([
      request(`/overview?days=${days}`, { token: activeToken }),
      request('/routers', { token: activeToken })
    ]);
    setOverview(overviewResponse.data);
    setRouters(routersResponse.data);
    setHeartbeatUpdatedAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    if (!authToken) return undefined;

    const refresh = async () => {
      try {
        await refreshHeartbeatStats(authToken, periodDays);
      } catch (error) {
        if (/unauthorized|invalid token|token expired/i.test(error.message)) logout();
        else notify(error.message, 'error');
      }
    };
    const interval = window.setInterval(refresh, 30000);
    return () => window.clearInterval(interval);
  }, [authToken, logout, notify, periodDays, refreshHeartbeatStats]);

  const refreshHeartbeatNow = useCallback(async () => {
    if (!authToken || heartbeatRefreshing) return;
    setHeartbeatRefreshing(true);
    try {
      await refreshHeartbeatStats(authToken, periodDays);
    } catch (error) {
      if (/unauthorized|invalid token|token expired/i.test(error.message)) logout();
      else notify(error.message, 'error');
    } finally {
      setHeartbeatRefreshing(false);
    }
  }, [authToken, heartbeatRefreshing, logout, notify, periodDays, refreshHeartbeatStats]);

  const checkRouterNow = useCallback(async (routerId) => {
    try {
      const response = await request('/routers', { token: authToken });
      setRouters(response.data);
      const router = response.data.find((item) => item.id === routerId);
      setModal((current) => current?.routerId === routerId
        ? {
          ...current,
          heartbeatAt: router?.last_seen_at || null,
          pollAt: router?.last_poll_at || null,
          setupStage: router?.setup_stage || null,
          setupUpdatedAt: router?.setup_updated_at || null
        }
        : current);
      if (router?.active && router.last_poll_at) {
        setRouterCheckError('');
        setModal((current) => current?.routerId === routerId
          ? { ...current, step: 'connected' }
          : current);
      } else if (router?.last_seen_at) {
        setRouterCheckError('Heartbeat received. Waiting for the first agent poll.');
      } else {
        setRouterCheckError('No router check-in yet. The initial setup must finish before polling can be confirmed.');
      }
    } catch (error) {
      setRouterCheckError(error.message);
    }
  }, [authToken]);

  useEffect(() => {
    if (modal?.type !== 'router-connect' || modal.step !== 'checking' || !authToken) return undefined;

    let cancelled = false;
    const checkConnection = async () => {
      if (cancelled) return;
      await checkRouterNow(modal.routerId);
    };

    checkConnection();
    const interval = window.setInterval(checkConnection, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authToken, checkRouterNow, modal?.type, modal?.step, modal?.routerId]);

  const activeTitle = navigation.find((item) => item.id === page)?.label || 'Overview';
  const activePlans = useMemo(() => plans.filter((plan) => plan.active), [plans]);
  function updateAuthField(event) {
    setAuthValues((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthNotice(null);
    try {
      if (authMode === 'verify') {
        await request('/auth/verify-email', {
          method: 'POST',
          body: JSON.stringify({ email: authValues.email, code: authValues.code })
        });
        setAuthMode('login');
        setAuthNotice({ message: 'Email verified. You can now log in.', type: 'success' });
        return;
      }
      if (authMode === 'register') {
        const data = await request('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: authValues.name,
            email: authValues.email,
            password: authValues.password
          })
        });
        setAuthValues((current) => ({ ...current, password: '' }));
        setAuthMode('verify');
        setAuthNotice({ message: data.message, type: 'success' });
        return;
      }
      const data = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: authValues.email, password: authValues.password })
      });
      localStorage.setItem('adminToken', data.token);
      localStorage.setItem('adminTenant', JSON.stringify(data.tenant));
      setTenant(data.tenant);
      setAuthToken(data.token);
    } catch (error) {
      const needsVerify = error.message === 'Email not verified';
      setAuthNotice({ message: error.message, type: 'error' });
      if (needsVerify) setAuthMode('verify');
    } finally {
      setAuthBusy(false);
    }
  }

  async function resendCode() {
    setAuthBusy(true);
    try {
      const data = await request('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: authValues.email })
      });
      setAuthMode('verify');
      setAuthNotice({ message: data.message, type: 'success' });
    } catch (error) {
      setAuthNotice({ message: error.message, type: 'error' });
    } finally {
      setAuthBusy(false);
    }
  }

  async function perform(action, successMessage, after) {
    setBusy(true);
    try {
      await action();
      if (successMessage) notify(successMessage);
      if (after) await after();
      setModal(null);
    } catch (error) {
      if (/unauthorized|invalid token|token expired/i.test(error.message)) logout();
      else notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function openNewPlan() {
    setModal({ type: 'plan', item: null });
  }

  function openNewRouter() {
    setRouterCheckError('');
    setScriptCopied(false);
    setModal({ type: 'router-details', item: null });
  }

  async function savePlan(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = {
      name: form.get('name'),
      price: form.get('price'),
      durationMin: form.get('durationMin'),
      profile: form.get('profile')
    };
    const item = modal.item;
    await perform(async () => {
      await request(item ? `/plans/${item.id}` : '/plans', {
        token: authToken,
        method: item ? 'PUT' : 'POST',
        body: JSON.stringify(values)
      });
    }, item ? 'Bundle updated.' : 'Bundle created.', () => loadWorkspace(authToken, periodDays));
  }

  async function togglePlan(plan) {
    const active = !plan.active;
    if (!active && !window.confirm(`Archive "${plan.name}"? Existing transactions will be retained.`)) return;
    await perform(async () => {
      await request(`/plans/${plan.id}`, {
        token: authToken,
        method: 'PUT',
        body: JSON.stringify({
          name: plan.name,
          price: plan.price,
          durationMin: plan.duration_min,
          profile: plan.mikrotik_profile,
          active
        })
      });
    }, active ? 'Bundle reactivated.' : 'Bundle archived.', () => loadWorkspace(authToken, periodDays));
  }

  async function saveRouter(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = {
      name: form.get('name'),
      lanInterface: form.get('lanInterface')
    };
    const item = modal.item;
    if (item?.id) {
      values.localIp = form.get('localIp');
      await perform(async () => {
        await request(`/routers/${item.id}`, {
          token: authToken,
          method: 'PUT',
          body: JSON.stringify(values)
        });
      }, 'Router updated.', () => loadWorkspace(authToken, periodDays));
      return;
    }

    setBusy(true);
    try {
      const response = await request('/routers', {
        token: authToken,
        method: 'POST',
        body: JSON.stringify(values)
      });
      setGeneratedScript(response.data.script);
      setScriptCopied(false);
      setRouterCheckError('');
      setModal({
        type: 'router-connect',
        routerId: response.data.routerId,
        routerName: values.name,
        lanInterface: values.lanInterface,
        step: 'script'
      });
      await loadWorkspace(authToken, periodDays);
    } catch (error) {
      if (/unauthorized|invalid token|token expired/i.test(error.message)) logout();
      else notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleRouter(router) {
    const active = !router.active;
    if (!active && !window.confirm(`Archive "${router.name}"? Transaction history will be retained.`)) return;
    await perform(async () => {
      await request(`/routers/${router.id}`, {
        token: authToken,
        method: 'PUT',
        body: JSON.stringify({ name: router.name, localIp: router.local_ip, active })
      });
    }, active ? 'Router reactivated.' : 'Router archived.', () => loadWorkspace(authToken, periodDays));
  }

  async function deleteRouters(routerIds) {
    setBusy(true);
    try {
      const response = await request('/routers/bulk', {
        token: authToken,
        method: 'DELETE',
        body: JSON.stringify({ routerIds })
      });
      notify(`Uninstall requested for ${response.data.requestedCount} router${response.data.requestedCount === 1 ? '' : 's'}. Offline routers will stay pending until they reconnect.`);
      await loadWorkspace(authToken, periodDays);
      return true;
    } catch (error) {
      if (/unauthorized|invalid token|token expired/i.test(error.message)) logout();
      else notify(error.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveMpesa(event) {
    event.preventDefault();
    await perform(async () => {
      await request('/settings/mpesa', {
        token: authToken,
        method: 'POST',
        body: JSON.stringify(mpesaForm)
      });
      setMpesaForm((current) => ({
        shortcode: current.shortcode,
        consumerKey: '',
        consumerSecret: '',
        passkey: ''
      }));
    }, 'M-Pesa credentials saved securely.', () => loadWorkspace(authToken, periodDays));
  }

  async function clearMpesa() {
    if (!window.confirm('Clear the stored M-Pesa credentials for this ISP?')) return;
    await perform(async () => {
      await request('/settings/mpesa', { token: authToken, method: 'DELETE' });
      setMpesaForm({ shortcode: '', consumerKey: '', consumerSecret: '', passkey: '' });
    }, 'M-Pesa settings cleared.', () => loadWorkspace(authToken, periodDays));
  }

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(generatedScript);
      setScriptCopied(true);
      notify('Setup script copied to clipboard.');
    } catch {
      notify('Clipboard access failed. Select and copy the script manually.', 'error');
    }
  }

  function navigate(nextPage) {
    setPage(nextPage);
    setMobileNavOpen(false);
  }

  function closeModal() {
    if (modal?.type === 'router-connect' && modal.step === 'script' && !scriptCopied
        && !window.confirm('The setup script contains a one-time router token. Close without copying it? You will need to generate a new router script to connect this device.')) {
      return;
    }
    setModal(null);
  }

  if (!authToken) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div className="brand-lockup"><span className="brand-mark"><Icon name="wifi" size={21} /></span><span>daraja<span className="brand-period">.</span></span></div>
          <div className="auth-intro">
            <span className="eyebrow">ISP WORKSPACE</span>
            <h1>{authMode === 'register' ? 'Get your network online.' : authMode === 'verify' ? 'Verify your email.' : 'Welcome back.'}</h1>
            <p>{authMode === 'verify' ? `Enter the 8-digit code sent to ${authValues.email}.` : authMode === 'register' ? 'Manage the MikroTik router and customer Wi-Fi service you operate.' : 'Manage your MikroTik routers, customer bundles, and M-Pesa checkout testing.'}</p>
          </div>
          {authNotice && <Notice notice={authNotice} />}
          <form className="auth-form" onSubmit={submitAuth}>
            {authMode === 'register' && <Field label="Business name" name="name" value={authValues.name} onChange={updateAuthField} placeholder="e.g. Acme Internet" autoComplete="organization" required />}
            {authMode !== 'verify' ? <>
              <Field label="Email address" name="email" type="email" value={authValues.email} onChange={updateAuthField} placeholder="you@company.com" autoComplete="email" required />
              <Field label="Password" name="password" type="password" value={authValues.password} onChange={updateAuthField} placeholder={authMode === 'register' ? 'At least 12 characters' : 'Enter your password'} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength={authMode === 'register' ? 12 : undefined} required />
            </> : <Field label="8-digit verification code" name="code" value={authValues.code} onChange={updateAuthField} placeholder="00000000" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required />}
            <button className="button button-primary auth-submit" disabled={authBusy}>
              {authBusy ? 'Please wait…' : authMode === 'register' ? 'Create ISP account' : authMode === 'verify' ? 'Verify email' : 'Sign in'}
            </button>
          </form>
          {authMode === 'verify' ? (
            <button className="text-button auth-switch" onClick={resendCode} disabled={authBusy}>Resend verification code</button>
          ) : (
            <p className="auth-switch">{authMode === 'register' ? 'Already have an account?' : 'New to Daraja?'} <button className="text-button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setAuthNotice(null); }}>{authMode === 'register' ? 'Sign in' : 'Create your ISP account'}</button></p>
          )}
          <div className="auth-assurance"><Icon name="shield" size={16} /> Your access and payment credentials are protected.</div>
        </section>
        <aside className="auth-aside">
          <div className="aside-top"><span className="status-dot" /> YOUR ISP, AT A GLANCE</div>
          <div className="aside-content">
            <span className="eyebrow eyebrow-light">BUILT FOR CONNECTIVITY</span>
            <h2>Simple tools.<br />Stronger connections.</h2>
            <p>Manage hotspot bundles, keep routers in view, and give customers a smoother way online.</p>
            <div className="aside-visual">
              <div className="visual-grid" />
              <div className="visual-node node-one"><Icon name="wifi" size={20} /></div>
              <div className="visual-node node-two"><span /></div>
              <div className="visual-node node-three"><span /></div>
              <div className="visual-line line-one" /><div className="visual-line line-two" />
              <div className="visual-label">NETWORK STATUS <strong>Ready when you are</strong></div>
            </div>
          </div>
          <div className="aside-footer">DAR A JA <span>·</span> ISP OPERATIONS</div>
        </aside>
      </main>
    );
  }

  return (
    <div className="app-shell">
      {mobileNavOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup sidebar-brand"><span className="brand-mark"><Icon name="wifi" size={20} /></span><span>daraja<span className="brand-period">.</span></span></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <button key={item.id} className={`nav-item ${page === item.id ? 'nav-active' : ''}`} onClick={() => navigate(item.id)}>
              <Icon name={item.icon} /><span>{item.label}</span>{page === item.id && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon"><Icon name="shield" size={17} /></span><strong>Your credentials stay private</strong><p>Payment credentials are encrypted before they are stored.</p></div>
          <div className="profile-row"><div className="avatar">{(tenant?.name || tenant?.email || 'I').slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{tenant?.name || 'ISP account'}</strong><span>{tenant?.email || 'Workspace admin'}</span></div><button className="icon-button logout-icon" title="Sign out" onClick={logout}><Icon name="logout" /></button></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Icon name="menu" /></button>
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-separator">/</span><strong>{activeTitle}</strong></div>
          <div className="topbar-right"><span className="secure-label"><Icon name="shield" size={15} /> Secure workspace</span><button className="avatar avatar-small" title={tenant?.email || 'Account'}>{(tenant?.name || 'I').slice(0, 1).toUpperCase()}</button></div>
        </header>
        <div className="content-wrap">
          {notice && <Notice notice={notice} />}
          {page === 'overview' && <Overview
            overview={overview}
            days={periodDays}
            onDaysChange={setPeriodDays}
            plans={activePlans}
            routers={routers}
            mpesa={mpesa}
            onNavigate={navigate}
            onCreateRouter={openNewRouter}
            onCreatePlan={openNewPlan}
            updatedAt={heartbeatUpdatedAt}
            refreshing={heartbeatRefreshing}
            onRefresh={refreshHeartbeatNow}
          />}
          {page === 'plans' && <PlansPage plans={plans} onCreate={openNewPlan} onEdit={(item) => setModal({ type: 'plan', item })} onToggle={togglePlan} busy={busy} />}
          {page === 'routers' && <RoutersPage routers={routers} onCreate={openNewRouter} onEdit={(item) => setModal({ type: 'router', item })} onToggle={toggleRouter} onDelete={deleteRouters} busy={busy} />}
          {page === 'payments' && <PaymentsPage mpesa={mpesa} form={mpesaForm} setForm={setMpesaForm} onSave={saveMpesa} onClear={clearMpesa} busy={busy} />}
        </div>
        <footer className="app-footer"><span>Daraja Hotspot</span><span>Secure ISP operations</span></footer>
      </main>
      {modal && <Modal
        modal={modal}
        onClose={closeModal}
        onSavePlan={savePlan}
        onSaveRouter={saveRouter}
        script={generatedScript}
        scriptCopied={scriptCopied}
        onCopy={copyScript}
        onContinueChecks={() => { setRouterCheckError(''); setModal((current) => ({ ...current, step: 'checking' })); }}
        onCheckRouter={() => checkRouterNow(modal.routerId)}
        connectionError={routerCheckError}
        busy={busy}
      />}
    </div>
  );
}

function Notice({ notice }) {
  return <div className={`notice notice-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}><span className="notice-dot" />{notice.message}</div>;
}

function Field({ label, name, type = 'text', value, onChange, placeholder, ...props }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} value={value} onChange={onChange} placeholder={placeholder} {...props} /></label>;
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Overview({
  overview, days, onDaysChange, plans, routers, mpesa, onNavigate, onCreateRouter, onCreatePlan,
  updatedAt, refreshing, onRefresh
}) {
  const currentRouters = routers.filter((router) => router.active).length;
  const metrics = overview?.payments;
  const pings = overview?.pings;
  return <>
    <PageHeading
      eyebrow="NETWORK OPERATIONS"
      title="Good to see you."
      description="Track payments, revenue, and router provisioning across your network."
      action={<label className="period-select-label">REPORTING PERIOD
        <select className="period-select" value={days} onChange={(event) => onDaysChange(Number(event.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </label>}
    />
    <BusinessReadiness
      plans={plans}
      routers={routers}
      mpesa={mpesa}
      onNavigate={onNavigate}
      onCreateRouter={onCreateRouter}
      onCreatePlan={onCreatePlan}
    />
    <section className="metric-grid">
      <MetricCard label="Successful revenue" value={formatKes(metrics?.revenue)} detail={`Last ${days} days · successful payments`} icon="arrow" tone="teal" />
      <MetricCard label="Successful payments" value={Number(metrics?.successful_payments || 0).toLocaleString()} detail={`${Number(metrics?.pending_payments || 0)} awaiting · ${Number(metrics?.failed_payments || 0)} failed`} icon="layers" tone="blue" />
      <MetricCard label="Routers online" value={`${Number(pings?.online_routers || 0)} / ${currentRouters}`} detail={`${Number(pings?.offline_routers || 0)} offline · active network devices`} icon="router" tone="gold" />
      <MetricCard label="Router pings · 24h" value={Number(pings?.received_24h || 0).toLocaleString()} detail={`${Number(pings?.received_1h || 0).toLocaleString()} received in the last hour`} icon="clock" tone="blue" />
    </section>
    <section className="surface-card payments-card">
      <div className="section-heading"><div><span className="eyebrow">ROUTER CONNECTIVITY</span><h2>Heartbeat activity</h2><p className="monitoring-caption">Routers report every 30 seconds; they show offline after 2 minutes without a check-in.</p></div><div className="monitoring-actions"><span className="monitoring-updated">Updated {formatRelativeTime(updatedAt)}</span><button className="button button-small button-quiet" onClick={onRefresh} disabled={refreshing} aria-label="Refresh router ping data"><Icon name="refresh" size={14} />{refreshing ? 'Refreshing…' : 'Refresh'}</button><button className="link-button" onClick={() => onNavigate('routers')}>Router details <Icon name="arrow" size={15} /></button></div></div>
      {routers.length ? <div className="table-scroll"><table><thead><tr><th>Router</th><th>Connection</th><th>Pings · last hour</th><th>Last heartbeat</th><th>Last agent poll</th></tr></thead><tbody>{routers.filter((router) => router.active).map((router) => <tr key={router.id}><td><strong>{router.name}</strong></td><td><StatusPill active={router.health === 'ONLINE'} label={router.health} /></td><td><strong>{Number(router.pings_last_hour || 0).toLocaleString()}</strong><span className="ping-count-caption">check-ins</span></td><td><span title={formatDateTime(router.last_seen_at)}>{formatRelativeTime(router.last_seen_at)}</span></td><td><span title={formatDateTime(router.last_poll_at)}>{formatRelativeTime(router.last_poll_at)}</span></td></tr>)}</tbody></table></div> : <EmptyState icon="router" title="No routers connected" body="Add a MikroTik router to start receiving agent heartbeat pings." action="Add a router" onClick={onCreateRouter} />}
    </section>
    <section className="surface-card chart-card">
      <div className="section-heading"><div><span className="eyebrow">PAYMENT PERFORMANCE</span><h2>Revenue over time</h2></div><span className="chart-legend"><i /> Successful revenue</span></div>
      <RevenueChart values={overview?.dailyRevenue || []} />
    </section>
    <div className="overview-grid">
      <section className="surface-card overview-card">
        <div className="section-heading"><div><span className="eyebrow">PAYMENT ACTIVITY</span><h2>Payment outcomes</h2></div></div>
        <div className="outcome-list">
          <OutcomeRow label="Successful" value={metrics?.successful_payments} status="success" />
          <OutcomeRow label="Pending" value={metrics?.pending_payments} status="pending" />
          <OutcomeRow label="Failed" value={metrics?.failed_payments} status="failed" />
          <OutcomeRow label="Cancelled" value={metrics?.cancelled_payments} status="muted" />
        </div>
      </section>
      <section className="surface-card overview-card">
        <div className="section-heading"><div><span className="eyebrow">MIKROTIK PROVISIONING</span><h2>User setup jobs</h2></div><button className="link-button" onClick={() => onNavigate('routers')}>Router details <Icon name="arrow" size={15} /></button></div>
        <div className="provisioning-grid">
          <ProvisionMetric label="Queued" value={overview?.provisioning?.pending} />
          <ProvisionMetric label="In progress" value={overview?.provisioning?.claimed} />
          <ProvisionMetric label="Completed" value={overview?.provisioning?.successful} />
          <ProvisionMetric label="Failed" value={overview?.provisioning?.failed} failed />
        </div>
        {Number(overview?.provisioning?.failed || 0) > 0 && <p className="provisioning-warning"><span /> Some provisioning jobs failed. Check router connectivity and setup.</p>}
      </section>
    </div>
    <section className="surface-card payments-card">
      <div className="section-heading"><div><span className="eyebrow">LATEST ACTIVITY</span><h2>Recent payments</h2></div><span className="subtle-caption">Most recent 10 · customer numbers masked</span></div>
      <RecentPayments payments={overview?.recentPayments || []} />
    </section>
    {!routers.length && <section className="setup-banner router-setup-banner">
      <div className="setup-emblem"><Icon name="router" size={21} /></div>
      <div className="setup-copy"><strong>Connect your first MikroTik router</strong><span>Add a router, paste its one-time setup script, and we’ll confirm when it checks in.</span></div>
      <button className="button button-outline" onClick={onCreateRouter}>Start router setup <Icon name="arrow" size={15} /></button>
    </section>}
    <section className="setup-banner">
      <div className="setup-emblem"><Icon name="shield" size={22} /></div>
      <div className="setup-copy"><strong>{mpesa.configured ? 'M-Pesa is ready for payments' : 'Finish setting up M-Pesa'}</strong><span>{mpesa.configured ? `Payments are configured for shortcode ${mpesa.mpesa_shortcode}.` : 'Add your Daraja credentials to start receiving customer payments.'}</span></div>
      <button className="button button-outline" onClick={() => onNavigate('payments')}>{mpesa.configured ? 'Review settings' : 'Configure M-Pesa'} <Icon name="arrow" size={15} /></button>
    </section>
  </>;
}

function BusinessReadiness({ plans, routers, mpesa, onNavigate, onCreateRouter, onCreatePlan }) {
  const readyRouter = routers.some((router) => (
    router.active
      && !router.uninstall_requested_at
      && router.health === 'ONLINE'
      && Boolean(router.last_poll_at)
      && router.setup_stage === 'complete'
  ));
  const checks = [
    {
      label: 'M-Pesa payments',
      complete: mpesa.configured,
      detail: mpesa.configured ? `Shortcode ${mpesa.mpesa_shortcode} is saved` : 'Connect your Safaricom Daraja shortcode',
      action: mpesa.configured ? 'Review' : 'Set up',
      onClick: () => onNavigate('payments')
    },
    {
      label: 'Customer Wi-Fi bundles',
      complete: plans.length > 0,
      detail: plans.length ? `${plans.length} active bundle${plans.length === 1 ? '' : 's'} available` : 'Create a price and access duration',
      action: plans.length ? 'Manage' : 'Create bundle',
      onClick: plans.length ? () => onNavigate('plans') : onCreatePlan
    },
    {
      label: 'Router ready',
      complete: readyRouter,
      detail: readyRouter
        ? 'Online and checking for customer access jobs'
        : routers.length
          ? 'Finish setup and wait for the first agent poll'
          : 'Connect the MikroTik serving your customers',
      action: readyRouter ? 'View' : routers.length ? 'Check router' : 'Add router',
      onClick: routers.length ? () => onNavigate('routers') : onCreateRouter
    }
  ];
  const completed = checks.filter((check) => check.complete).length;
  const ready = completed === checks.length;

  return <section className={`business-readiness ${ready ? 'business-readiness-ready' : ''}`} aria-labelledby="business-readiness-title">
    <div className="readiness-heading">
      <div>
        <span className="eyebrow">{ready ? 'BUSINESS STATUS' : 'GETTING STARTED'}</span>
        <h2 id="business-readiness-title">{ready ? 'You’re ready to take payments' : 'Get ready to take your first payment'}</h2>
        <p>{ready
          ? 'Your payment setup, customer bundles, and router are connected. Run a small checkout test before sharing your Wi-Fi details.'
          : 'Complete these essentials so customers can pay with M-Pesa and get online.'}</p>
      </div>
      <div className="readiness-count" aria-label={`${completed} of ${checks.length} setup steps complete`}>
        <strong>{completed}<span>/{checks.length}</span></strong>
        <small>ready</small>
      </div>
    </div>
    <div className="readiness-progress" aria-hidden="true"><span style={{ width: `${(completed / checks.length) * 100}%` }} /></div>
    <div className="readiness-checks">
      {checks.map((check) => <article className={`readiness-check ${check.complete ? 'readiness-check-complete' : ''}`} key={check.label}>
        <span className="readiness-check-icon"><Icon name={check.complete ? 'check' : check.label === 'Router ready' ? 'router' : check.label === 'Customer Wi-Fi bundles' ? 'layers' : 'shield'} size={16} /></span>
        <div className="readiness-check-copy">
          <strong>{check.label}</strong>
          <span>{check.detail}</span>
        </div>
        <button className="link-button" onClick={check.onClick}>{check.action} <Icon name="arrow" size={14} /></button>
      </article>)}
    </div>
  </section>;
}

function RevenueChart({ values }) {
  const width = 720;
  const height = 180;
  const chartTop = 14;
  const chartBottom = 139;
  const chartHeight = chartBottom - chartTop;
  const gap = values.length > 45 ? 3 : 5;
  const barWidth = Math.max(2, (width - gap * Math.max(0, values.length - 1)) / Math.max(1, values.length));
  const maximum = Math.max(1, ...values.map((item) => Number(item.revenue || 0)));
  const dateIndexes = [0, Math.floor((values.length - 1) / 3), Math.floor((values.length - 1) * 2 / 3), values.length - 1];
  return values.length ? <figure className="revenue-chart" aria-label="Daily successful revenue">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Revenue for each of the last ${values.length} days`}>
      {[0, 1, 2, 3].map((line) => {
        const y = chartTop + (chartHeight / 3) * line;
        return <line key={line} x1="0" x2={width} y1={y} y2={y} className="chart-gridline" />;
      })}
      {values.map((item, index) => {
        const revenue = Number(item.revenue || 0);
        const barHeight = revenue > 0 ? Math.max(3, revenue / maximum * chartHeight) : 0;
        const x = index * (barWidth + gap);
        return <rect key={item.date} x={x} y={chartBottom - barHeight} width={barWidth} height={barHeight} rx={Math.min(3, barWidth / 2)} className={revenue ? 'chart-bar' : 'chart-bar-empty'}>
          <title>{`${formatChartDate(item.date)} · ${formatKes(revenue)} · ${item.transactions} successful payments`}</title>
        </rect>;
      })}
    </svg>
    <div className="chart-dates">{dateIndexes.map((index) => values[index] && <span key={values[index].date}>{formatChartDate(values[index].date)}</span>)}</div>
  </figure> : <EmptyState icon="arrow" title="No revenue to chart yet" body="Successful payments will appear here as your customers buy access." />;
}

function formatChartDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('en-KE') : 'Not received yet';
}

function formatRelativeTime(value) {
  if (!value) return 'Never received';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 10) return 'Just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

function getRouterSetupStageIndex(stage) {
  return routerSetupStages.findIndex(([key]) => key === stage);
}

function isRouterSetupStalled(updatedAt, pollAt) {
  return !pollAt && updatedAt && Date.now() - new Date(updatedAt).getTime() > 90000;
}

function OutcomeRow({ label, value, status }) {
  return <div className="outcome-row"><StatusPill active={status === 'success'} label={label} /><strong className={`outcome-value outcome-${status}`}>{Number(value || 0).toLocaleString()}</strong></div>;
}

function ProvisionMetric({ label, value, failed = false }) {
  return <div className={`provision-metric ${failed && Number(value) > 0 ? 'provision-failed' : ''}`}><strong>{Number(value || 0).toLocaleString()}</strong><span>{label}</span></div>;
}

function RecentPayments({ payments }) {
  return payments.length ? <div className="table-scroll recent-payments-scroll"><table><thead><tr><th>Time</th><th>Customer phone</th><th>Amount</th><th>Outcome</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{new Date(payment.created_at).toLocaleString()}</td><td><code className="profile-code">{payment.phone}</code></td><td><strong className="payment-amount">{formatKes(payment.amount)}</strong></td><td><StatusPill active={payment.status === 'SUCCESS'} label={payment.status.toLowerCase()} /></td></tr>)}</tbody></table></div> : <EmptyState icon="layers" title="No recent payments" body="Customer payment activity will show here once checkouts start." />;
}

function MetricCard({ label, value, detail, icon, tone }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon metric-${tone}`}><Icon name={icon} size={18} /></span></div><strong className="metric-value">{value}</strong><span className="metric-detail">{detail}</span><div className={`metric-accent accent-${tone}`} /></article>;
}

function EmptyState({ icon, title, body, action, onClick }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={20} /></span><strong>{title}</strong><p>{body}</p>{action && <button className="link-button" onClick={onClick}>{action} <Icon name="arrow" size={14} /></button>}</div>;
}

function StatusPill({ active, label }) {
  return <span className={`status-pill ${active ? 'status-good' : 'status-muted'}`}><span />{label}</span>;
}

function PlansPage({ plans, onCreate, onEdit, onToggle, busy }) {
  const activeCount = plans.filter((plan) => plan.active).length;
  return <>
    <PageHeading eyebrow="CUSTOMER OFFERINGS" title="Hotspot bundles" description="Set up and manage the packages your customers can purchase." action={<button className="button button-primary" onClick={onCreate}><Icon name="plus" /> New bundle</button>} />
    <div className="list-summary"><span><strong>{activeCount}</strong> active bundles</span><span>{plans.length} total</span></div>
    <section className="surface-card table-card">
      {plans.length ? <div className="table-scroll"><table><thead><tr><th>Bundle</th><th>Price</th><th>Access time</th><th>MikroTik profile</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id}><td><div className="table-primary"><span className="table-icon"><Icon name="layers" /></span><strong>{plan.name}</strong></div></td><td>{formatKes(plan.price)}</td><td>{plan.duration_min} min</td><td><code className="profile-code">{plan.mikrotik_profile}</code></td><td><StatusPill active={plan.active} label={plan.active ? 'Active' : 'Archived'} /></td><td><div className="row-actions"><button className="icon-button" title="Edit bundle" disabled={busy} onClick={() => onEdit(plan)}><Icon name="edit" /></button><button className="button button-small button-quiet" disabled={busy} onClick={() => onToggle(plan)}>{plan.active ? 'Archive' : 'Reactivate'}</button></div></td></tr>)}</tbody></table></div> : <EmptyState icon="layers" title="Create your first bundle" body="Define access time and pricing for your hotspot customers." action="Add a bundle" onClick={onCreate} />}
    </section>
    <p className="privacy-note"><Icon name="shield" size={15} /> Archived bundles stay in your history and are no longer offered to customers.</p>
  </>;
}

function RoutersPage({ routers, onCreate, onEdit, onToggle, onDelete, busy }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedRouters = routers.filter((router) => selectedIds.includes(router.id));
  const protectedRouters = selectedRouters.filter((router) => Number(router.transaction_count) > 0);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => routers.some((router) => router.id === id)));
  }, [routers]);

  function toggleSelected(routerId) {
    setSelectedIds((current) => current.includes(routerId)
      ? current.filter((id) => id !== routerId)
      : [...current, routerId]);
  }

  function toggleAll() {
    setSelectedIds((current) => current.length === routers.length
      ? []
      : routers.map((router) => router.id));
  }

  async function confirmBulkDelete() {
    const deleted = await onDelete(selectedIds);
    if (deleted) {
      setSelectedIds([]);
      setConfirmDelete(false);
    }
  }

  return <>
    <PageHeading eyebrow="NETWORK MANAGEMENT" title="Your routers" description="Connect MikroTik routers and monitor their connection health." action={<button className="button button-primary" onClick={onCreate}><Icon name="plus" /> Add router</button>} />
    <div className="list-summary"><span><strong>{routers.filter((router) => router.active && router.health === 'ONLINE').length}</strong> online</span><span>{routers.filter((router) => router.active).length} active · {routers.length} total</span></div>
    {routers.length > 0 && <div className="router-selection-bar">
      <div className="router-selection-copy">
        <strong>{selectedIds.length ? `${selectedIds.length} selected` : 'Manage routers'}</strong>
        <span>Select routers to uninstall Daraja and remove their workspace entries.</span>
      </div>
      <div className="router-selection-actions">
        <button className="button button-small button-quiet" onClick={toggleAll} disabled={busy}>
          {selectedIds.length === routers.length ? 'Clear selection' : 'Select all'}
        </button>
        {selectedIds.length > 0 && <button className="button button-small button-danger-outline" onClick={() => setConfirmDelete(true)} disabled={busy}>
          <Icon name="trash" size={14} /> Uninstall &amp; delete
        </button>}
      </div>
    </div>}
    <section className="surface-card table-card">
      {routers.length ? <div className="table-scroll"><table><thead><tr><th><span className="sr-only">Select</span></th><th>Router</th><th>Hotspot gateway</th><th>Connection</th><th>Pings · last hour</th><th>Last heartbeat</th><th>Last agent poll</th><th>Payments</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{routers.map((router) => {
        const uninstallPending = Boolean(router.uninstall_requested_at);
        const uninstallComplete = Boolean(router.uninstall_completed_at);
        return <tr key={router.id} className={selectedIds.includes(router.id) ? 'router-row-selected' : ''}><td><input className="router-select-checkbox" type="checkbox" aria-label={`Select ${router.name}`} checked={selectedIds.includes(router.id)} onChange={() => toggleSelected(router.id)} disabled={busy} /></td><td><div className="table-primary"><span className="table-icon"><Icon name="router" /></span><strong>{router.name}</strong></div></td><td><code className="profile-code">{router.local_ip}</code></td><td><StatusPill active={router.active && router.health === 'ONLINE'} label={router.active ? router.health : 'OFFLINE'} /></td><td>{Number(router.pings_last_hour || 0).toLocaleString()}</td><td>{formatDateTime(router.last_seen_at)}</td><td>{formatDateTime(router.last_poll_at)}</td><td>{Number(router.transaction_count || 0).toLocaleString()}</td><td><StatusPill active={router.active && !uninstallPending} label={uninstallPending ? (uninstallComplete ? 'Cleanup confirmed' : 'Uninstall pending') : router.active ? 'Active' : 'Archived'} /></td><td><div className="row-actions"><button className="icon-button" title="Edit router" disabled={busy || uninstallPending} onClick={() => onEdit(router)}><Icon name="edit" /></button><button className="button button-small button-quiet" disabled={busy || uninstallPending} onClick={() => onToggle(router)}>{router.active ? 'Archive' : 'Reactivate'}</button></div></td></tr>;
      })}</tbody></table></div> : <EmptyState icon="router" title="Connect your first router" body="Add a MikroTik router to start receiving agent heartbeat pings." action="Add router" onClick={onCreate} />}
    </section>
    <p className="privacy-note"><Icon name="shield" size={15} /> Uninstall removes Daraja-owned hotspot, DHCP, portal, and agent items when the router checks in. Offline routers stay pending; routers with payment history must be archived to preserve records.</p>
    {confirmDelete && <div className="confirm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmDelete(false); }}>
      <section className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title">
        <span className="confirm-icon"><Icon name="trash" size={20} /></span>
        <h2 id="bulk-delete-title">Uninstall Daraja from {selectedIds.length} router{selectedIds.length === 1 ? '' : 's'}?</h2>
        <p>Each selected router must be online to receive the uninstall job. It will remove Daraja-owned hotspot users, hotspot server/profile, DHCP items, portal page, and agent script/scheduler. WAN, bridge, Wi-Fi, and unrelated router configuration are left alone. Offline routers remain listed as pending until they reconnect and confirm cleanup.</p>
        {protectedRouters.length > 0
          ? <div className="confirm-warning"><strong>{protectedRouters.length} selected router{protectedRouters.length === 1 ? ' has' : 's have'} payment history and can’t be deleted.</strong><span>Close this dialog, unselect {protectedRouters.length === 1 ? 'it' : 'them'}, or archive them to keep the transaction history.</span></div>
          : <div className="confirm-warning"><strong>Payment records are protected.</strong><span>Routers with linked payments are rejected; archive those instead. Router records are removed only after the device confirms its uninstall.</span></div>}
        <div className="confirm-actions">
          <button className="button button-secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>Cancel</button>
          <button className="button button-danger" onClick={confirmBulkDelete} disabled={busy || protectedRouters.length > 0}>
            <Icon name="trash" size={15} /> {busy ? 'Requesting…' : `Uninstall ${selectedIds.length} router${selectedIds.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </section>
    </div>}
  </>;
}

function PaymentsPage({ mpesa, form, setForm, onSave, onClear, busy }) {
  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }
  return <>
    <PageHeading eyebrow="PAYMENT SETUP" title="M-Pesa settings" description="Configure Safaricom Daraja credentials for sandbox checkout testing." />
    <div className="payments-layout">
      <section className="surface-card form-card">
        <div className="section-heading"><div><span className="eyebrow">DARAJA API</span><h2>Business credentials</h2></div><StatusPill active={mpesa.configured} label={mpesa.configured ? 'Configured' : 'Not configured'} /></div>
        <div className="payment-environment-warning" role="note"><strong>Sandbox testing only</strong><span>This build sends STK Push requests to Safaricom's sandbox using the Paybill transaction type. It cannot collect live payments or accept Till/Buy Goods credentials. Use sandbox credentials and test numbers only; production payments are not enabled.</span></div>
        <p className="form-intro">Your credentials are encrypted before they are stored. Secret values are never shown after saving.</p>
        <form className="settings-form" onSubmit={onSave}>
          <Field label="Sandbox Paybill shortcode" name="shortcode" value={form.shortcode} onChange={update} placeholder="Safaricom sandbox shortcode" required />
          <Field label="Consumer key" name="consumerKey" type="password" value={form.consumerKey} onChange={update} placeholder={mpesa.configured ? 'Enter a new key to replace' : 'Your Daraja consumer key'} autoComplete="new-password" required />
          <Field label="Consumer secret" name="consumerSecret" type="password" value={form.consumerSecret} onChange={update} placeholder={mpesa.configured ? 'Enter a new secret to replace' : 'Your Daraja consumer secret'} autoComplete="new-password" required />
          <Field label="Lipa Na M-Pesa passkey" name="passkey" type="password" value={form.passkey} onChange={update} placeholder={mpesa.configured ? 'Enter a new passkey to replace' : 'Your Lipa Na M-Pesa passkey'} autoComplete="new-password" required />
          <div className="form-actions"><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save credentials'}</button>{mpesa.configured && <button className="button button-danger-outline" type="button" onClick={onClear} disabled={busy}>Clear credentials</button>}</div>
        </form>
      </section>
      <aside className="surface-card guidance-card"><span className="guidance-icon"><Icon name="shield" size={20} /></span><h3>Designed to protect your keys</h3><p>Payment secrets are encrypted before they reach the database. The dashboard only shows whether your account is configured.</p><div className="guidance-divider" /><div className="guidance-check"><Icon name="check" size={16} /><span>Credentials are never returned by the settings API</span></div><div className="guidance-check"><Icon name="check" size={16} /><span>Only your tenant’s settings are accessible to your account</span></div></aside>
    </div>
  </>;
}

function Modal({
  modal,
  onClose,
  onSavePlan,
  onSaveRouter,
  script,
  scriptCopied,
  onCopy,
  onContinueChecks,
  onCheckRouter,
  connectionError,
  busy
}) {
  const isPlan = modal.type === 'plan';
  const isRouter = modal.type === 'router' || modal.type === 'router-details';
  const isRouterConnect = modal.type === 'router-connect';
  const item = modal.item || {};
  const heading = isPlan
    ? (item.id ? 'Edit bundle' : 'Create bundle')
    : (item.id ? 'Edit router' : 'Provision a router');
  const connectHeading = modal.step === 'script'
    ? 'Paste one setup command'
    : modal.step === 'connected'
      ? 'Router connected'
      : 'Waiting for your router';
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-heading"><div><span className="eyebrow">{isRouterConnect ? 'ROUTER SETUP · STEP 2 OF 3' : isRouter && !item.id ? 'ROUTER SETUP · STEP 1 OF 3' : isPlan ? 'CUSTOMER OFFERING' : 'NETWORK DEVICE'}</span><h2 id="modal-title">{isRouterConnect ? connectHeading : heading}</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
      {isPlan && <form className="settings-form" onSubmit={onSavePlan}><Field label="Bundle name" name="name" defaultValue={item.name || ''} placeholder="e.g. 1 hour access" required /><div className="field-grid"><Field label="Price (KES)" name="price" type="number" min="0.01" step="0.01" defaultValue={item.price ?? ''} placeholder="20" required /><Field label="Duration (minutes)" name="durationMin" type="number" min="1" step="1" defaultValue={item.duration_min ?? ''} placeholder="60" required /></div><Field label="MikroTik profile" name="profile" defaultValue={item.mikrotik_profile || ''} placeholder="e.g. hourly" required /><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : item.id ? 'Save changes' : 'Create bundle'}</button></div></form>}
      {isRouter && <form className="settings-form" onSubmit={onSaveRouter}>{!item.id && <p className="form-intro">The setup detects the internet-facing interface and can detect a single safe customer LAN. If your router has multiple possible LANs, enter the confirmed customer LAN interface below instead of letting setup guess. A selected interface is checked against the WAN before use. If the LAN has no IP, setup checks for an unused private /24 subnet before assigning one.</p>}<Field label="Router name" name="name" defaultValue={item.name || ''} placeholder="e.g. Estate main router" required />{!item.id && <Field label="Customer LAN interface (optional)" name="lanInterface" placeholder="e.g. ether3" maxLength={64} pattern="[a-zA-Z0-9_.-]*" />} {item.id && <Field label="Hotspot gateway IP" name="localIp" defaultValue={item.local_ip || ''} placeholder="192.168.88.1" required />}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : item.id ? 'Save changes' : 'Generate router commands'}</button></div></form>}
      {isRouterConnect && <>
        <div className="wizard-steps"><span className="wizard-step wizard-step-done"><span><Icon name="check" size={12} /></span>Details</span><i className="wizard-step-divider" /><span className={`wizard-step ${modal.step === 'script' ? 'wizard-step-active' : 'wizard-step-done'}`}><span>{modal.step === 'script' ? '2' : <Icon name="check" size={12} />}</span>Paste script</span><i className="wizard-step-divider" /><span className={`wizard-step ${modal.step === 'checking' || modal.step === 'connected' ? 'wizard-step-active' : ''}`}><span>3</span>Confirm connection</span></div>
        {modal.step === 'script' && <div className="settings-form"><div className="router-instructions"><strong>{modal.routerName || 'New router'} · on your MikroTik:</strong><span>1. Open RouterOS Terminal with an administrator account.</span><span>2. Copy the single line below, paste it, and press Enter. It verifies the WAN, then uses {modal.lanInterface || 'the detected customer LAN'} to select the customer interface.</span><span>3. The router then installs the hotspot and agent, checks in, and polls Daraja for provisioning commands every 30 seconds.</span></div><textarea className="script-output" aria-label="One-line MikroTik setup command" readOnly value={script} /><div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Close setup</button><button className="button button-outline" onClick={onCopy}><Icon name="copy" /> {scriptCopied ? 'Copied' : 'Copy command'}</button><button className="button button-primary" onClick={onContinueChecks}>I’ve pasted it</button></div></div>}
        {modal.step === 'checking' && <div className="settings-form"><div className="connection-waiting"><span className="connection-spinner" /><div><strong>Watching the router setup</strong><p>The dashboard refreshes progress automatically. Each checkpoint is reported by the MikroTik as it downloads and imports the installer.</p></div></div><div className="router-setup-progress" aria-live="polite"><strong>{modal.setupStage ? `Last checkpoint: ${routerSetupStages[getRouterSetupStageIndex(modal.setupStage)]?.[1] || modal.setupStage}` : 'Waiting for first setup checkpoint'}</strong><ol>{routerSetupStages.map(([stage, label], index) => <li key={stage} className={index === getRouterSetupStageIndex(modal.setupStage) ? 'router-stage-current' : index < getRouterSetupStageIndex(modal.setupStage) ? 'router-stage-done' : ''}><span>{index < getRouterSetupStageIndex(modal.setupStage) ? '✓' : index + 1}</span>{label}</li>)}</ol><small>Last update: {formatDateTime(modal.setupUpdatedAt)}</small></div>{isRouterSetupStalled(modal.setupUpdatedAt, modal.pollAt) && <p className="connection-error" role="alert">Setup has not reported another step for over 90 seconds. It may have stopped at “{routerSetupStages[getRouterSetupStageIndex(modal.setupStage)]?.[1] || modal.setupStage}”. Check the MikroTik terminal for the first import error.</p>}<div className="router-test-status"><div><span className={`router-test-indicator ${modal.heartbeatAt ? 'router-test-received' : ''}`} /><span><strong>Heartbeat</strong><small>{formatDateTime(modal.heartbeatAt)}</small></span></div><div><span className={`router-test-indicator ${modal.pollAt ? 'router-test-received' : ''}`} /><span><strong>Agent poll</strong><small>{formatDateTime(modal.pollAt)}</small></span></div></div>{connectionError && <p className="connection-error" role="status">{connectionError}</p>}<div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Check later</button><button className="button button-outline" onClick={onCheckRouter}>Check now</button></div></div>}
        {modal.step === 'connected' && <div className="settings-form"><div className="connection-success"><span className="connection-success-icon"><Icon name="check" size={22} /></span><strong>MikroTik agent poll received</strong><p>The router has reached the backend poll endpoint. Heartbeat: {formatDateTime(modal.heartbeatAt)}. Last poll: {formatDateTime(modal.pollAt)}.</p></div><div className="modal-actions"><button className="button button-primary" onClick={onClose}>Done</button></div></div>}
      </>}
    </section>
  </div>;
}

export default App;
