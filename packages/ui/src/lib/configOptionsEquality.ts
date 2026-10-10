import type { ZCodeConfigOption } from "@zcode/shared";

function areJsonEquivalent(left: unknown, right: unknown): boolean {
  // 引用相同直接判等：config option 数组在 store 未变化时引用稳定，
  // 旧实现无条件 stringify 两份会造成每次对比都做完整序列化。
  if (left === right) {
    return true;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

export function areConfigOptionsEquivalent(
  left: readonly ZCodeConfigOption[] | null | undefined,
  right: readonly ZCodeConfigOption[] | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((option, index) => {
    const rightOption = right[index];
    return Boolean(rightOption) && areJsonEquivalent(option, rightOption);
  });
}
