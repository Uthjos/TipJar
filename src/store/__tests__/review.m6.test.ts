/**
 * Milestone 6 decisions from the main-branch review (docs/review-log.md, round 6).
 * Finding numbers (#n) refer to docs/test-findings.md.
 */
import { checkTeamHours } from '@/lib/hoursInput';
import { typedTeam, useShiftStore } from '@/store/shiftStore';

beforeEach(() => useShiftStore.setState(useShiftStore.getInitialState(), true));

describe('#79: copyHoursToRole clears the other members’ pending typed text', () => {
  it('copied committed hours are not overridden by stale typed text', () => {
    const st = useShiftStore.getState();
    const david = st.addMember('barback', 'David');
    const allen = st.addMember('barback', 'Allen');
    const hannah = st.addMember('host', 'Hannah');
    st.updateMember(david, { hours: 6 });
    st.setTyped(david, { mode: 'hours', hoursText: '6' });
    // Allen has leftover typed text that would otherwise win over the copied value
    st.setTyped(allen, { mode: 'clock', clockInText: 'abc', clockOutText: '' });
    st.setTyped(hannah, { mode: 'hours', hoursText: '4' });

    useShiftStore.getState().copyHoursToRole(david);

    const { draft } = useShiftStore.getState();
    expect(draft.team.find((m) => m.id === allen)).toMatchObject({ hours: 6 });
    expect(draft.typed[allen]).toEqual({ mode: 'hours' });
    // other roles untouched
    expect(draft.typed[hannah]).toEqual({ mode: 'hours', hoursText: '4' });
    const merged = typedTeam(draft).find((m) => m.id === allen)!;
    expect(merged.clockInText).toBeUndefined();
    expect(checkTeamHours(typedTeam(draft), ['barback'])).toEqual([]);
  });
});
