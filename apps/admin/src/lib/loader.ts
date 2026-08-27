import { notFound } from '@tanstack/react-router';
import { ApiClientError } from '../api/client';

/**
 * UX-15: a detail route whose entity does not exist is a MISSING page, not a broken one.
 * Without this a bad id renders the "เกิดข้อผิดพลาด · ลองใหม่" card, which invites the user
 * to retry something that will never succeed. Every other failure still surfaces as an error.
 */
export const notFoundOn404 = async <T>(promise: Promise<T>): Promise<T> => {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      throw notFound();
    }
    throw error;
  }
};
