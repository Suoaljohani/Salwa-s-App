import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { usePrefs } from './prefs';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'not_owner'; email: string | null }
  | { status: 'ready'; session: Session };

/** Sign-in state plus the single-owner check (claim_owner succeeds only for the one allowed account). */
export function useAuth(): AuthState {
  const demo = usePrefs((p) => p.demoMode);
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  useEffect(() => {
    if (demo) return;
    let alive = true;
    const sb = supabase();
    const check = async (session: Session | null) => {
      if (!session) { if (alive) setState({ status: 'signed_out' }); return; }
      const { data, error } = await sb.rpc('claim_owner');
      if (!alive) return;
      if (error || data !== true) setState({ status: 'not_owner', email: session.user.email ?? null });
      else setState({ status: 'ready', session });
    };
    sb.auth.getSession().then(({ data }) => check(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void check(session);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [demo]);
  return state;
}
