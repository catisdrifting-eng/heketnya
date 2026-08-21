import { useCallback, useRef, useState } from 'react';

/**
 * 버튼 등 액션 트리거의 중복 실행을 막는 훅.
 *
 * useState의 pending만으로는 리렌더가 일어나기 전에 두 번째 클릭이
 * 통과할 수 있으므로, useRef로 동기적인 잠금 플래그를 함께 둔다.
 */
export function useActionLock() {
  const lockedRef = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(async (fn: () => unknown | Promise<unknown>) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setPending(true);
    try {
      await fn();
    } finally {
      lockedRef.current = false;
      setPending(false);
    }
  }, []);

  return { run, pending };
}
