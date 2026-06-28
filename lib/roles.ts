interface Role {
  id: string;
  label: string;
}

// custom_roles 배열에서 id로 label 찾기. 없으면 id 그대로 반환.
export function getRoleLabel(roleId: string | null, roles: Role[]): string {
  if (!roleId) return '미지정';
  const found = roles.find((r) => r.id === roleId);
  return found?.label ?? roleId;
}

// id 문자열을 해시해서 일관된 색상 클래스 반환 (Tailwind)
export function getRoleColor(roleId: string | null): string {
  if (!roleId) return 'bg-gray-100 text-gray-600';
  const colors = [
    'bg-blue-50 text-blue-700',
    'bg-purple-50 text-purple-700',
    'bg-green-50 text-green-700',
    'bg-amber-50 text-amber-700',
    'bg-pink-50 text-pink-700',
    'bg-teal-50 text-teal-700',
  ];
  let hash = 0;
  for (let i = 0; i < roleId.length; i++) {
    hash = roleId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
