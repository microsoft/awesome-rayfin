/**
 * Build the scene with the headset budget? In the Quest browser always; elsewhere only when the
 * address asks for it (`?xr=1`, the direct link the app offers inside the Fabric frame), so a
 * desktop keeps its full detail.
 */
export function wantsHeadsetBudget(search = window.location.search, userAgent = navigator.userAgent): boolean {
  return /OculusBrowser|Quest/i.test(userAgent) || new URLSearchParams(search).get('xr') === '1';
}
