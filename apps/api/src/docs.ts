import { ERROR_CODES } from '@reserveflow/shared';
import { z } from 'zod';

import { signInSchema } from './auth/routes.js';

// ponytail: hand-assembled document — this route count doesn't justify hono-openapi's peer
// chain. Request bodies convert from the live zod validators via z.toJSONSchema, so those
// can't drift; paths and responses are maintained here, kept honest by the inventory test.

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
});

const jsonResponse = (description: string, schema: unknown) => ({
  description,
  content: { 'application/json': { schema } },
});

const sessionCookie = [{ sessionCookie: [] }];
const unauthenticated = { 401: errorResponse('UNAUTHENTICATED') };

const bangkokTimestamp = {
  type: 'string',
  description: 'ISO 8601 rendered at +07:00 (Asia/Bangkok)',
};

const userSchema = {
  type: 'object',
  required: [
    'id',
    'employee_code',
    'full_name',
    'email',
    'mobile',
    'role',
    'status',
    'department_id',
    'last_login_at',
  ],
  properties: {
    id: { type: 'string' },
    employee_code: { type: 'string' },
    full_name: { type: 'string' },
    email: { type: 'string', format: 'email' },
    mobile: { type: ['string', 'null'] },
    role: { type: 'string', enum: ['EMPLOYEE', 'ADMIN', 'FACILITY'] },
    status: { type: 'string', enum: ['INVITED', 'ACTIVE', 'DISABLED'] },
    department_id: { type: 'string', format: 'uuid' },
    last_login_at: { ...bangkokTimestamp, type: ['string', 'null'] },
  },
};

const departmentSchema = {
  type: 'object',
  required: ['id', 'code', 'name'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    code: { type: 'string' },
    name: { type: 'string' },
  },
};

const roomSummarySchema = {
  type: 'object',
  required: ['id', 'code', 'name', 'floor', 'capacity'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    code: { type: 'string' },
    name: { type: 'string' },
    floor: { type: ['string', 'null'] },
    capacity: { type: 'integer' },
  },
};

const roomFeatureSchema = {
  type: 'object',
  required: ['key', 'name', 'icon', 'quantity'],
  properties: {
    key: { type: 'string' },
    name: { type: 'string' },
    icon: { type: ['string', 'null'] },
    quantity: { type: 'integer' },
  },
};

const roomSchema = {
  type: 'object',
  required: [
    'id',
    'code',
    'name',
    'floor',
    'location',
    'description',
    'capacity',
    'photo_url',
    'active',
    'features',
    'created_at',
    'updated_at',
  ],
  properties: {
    ...roomSummarySchema.properties,
    location: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    photo_url: {
      type: ['string', 'null'],
      description: '`/api/v1/rooms/{id}/photo` when a photo exists',
    },
    active: { type: 'boolean' },
    features: { type: 'array', items: { $ref: '#/components/schemas/RoomFeature' } },
    created_at: bangkokTimestamp,
    updated_at: bangkokTimestamp,
  },
};

const viewerBookingSchema = {
  type: 'object',
  description:
    'Privacy-leveled view (C-16). `visibility: BUSY` carries only the required base keys; ' +
    'PUBLIC adds title, owner, and attendee_count; FULL (viewer is the owner, an attendee, ' +
    'or ADMIN) adds the rest. Masked fields are absent, never null.',
  required: [
    'id',
    'room_id',
    'start_at',
    'end_at',
    'status',
    'is_private',
    'is_mine',
    'visibility',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    room_id: { type: 'string', format: 'uuid' },
    start_at: bangkokTimestamp,
    end_at: bangkokTimestamp,
    status: { type: 'string' },
    is_private: { type: 'boolean' },
    is_mine: { type: 'boolean' },
    visibility: { type: 'string', enum: ['BUSY', 'PUBLIC', 'FULL'] },
    title: { type: 'string' },
    owner: {
      type: 'object',
      required: ['id', 'full_name', 'department'],
      properties: {
        id: { type: 'string' },
        full_name: { type: 'string' },
        department: { oneOf: [{ $ref: '#/components/schemas/Department' }, { type: 'null' }] },
      },
    },
    attendee_count: { type: 'integer' },
    description: { type: ['string', 'null'] },
    special_request: { type: ['string', 'null'] },
    headcount: { type: ['integer', 'null'] },
    version: { type: 'integer' },
    attendees: {
      type: 'array',
      items: {
        type: 'object',
        required: ['email', 'name'],
        properties: { email: { type: 'string' }, name: { type: ['string', 'null'] } },
      },
    },
    checkin: {
      type: ['object', 'null'],
      properties: {
        checked_in_at: bangkokTimestamp,
        method: { type: 'string', enum: ['SELF', 'QR', 'ADMIN'] },
      },
    },
    created_at: bangkokTimestamp,
    updated_at: bangkokTimestamp,
  },
};

const userWithDepartment = {
  type: 'object',
  required: ['user', 'department', 'capabilities'],
  properties: {
    user: { $ref: '#/components/schemas/User' },
    department: { $ref: '#/components/schemas/Department' },
    capabilities: {
      type: 'object',
      required: ['demo_check_in'],
      properties: { demo_check_in: { type: 'boolean' } },
    },
  },
};

const featuresParameter = {
  name: 'features',
  in: 'query',
  schema: { type: 'string' },
  description: 'Comma-separated feature keys; every listed key must be present',
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'ReserveFlow API',
    version: '1.0.0',
    description:
      'Every error response is an ErrorEnvelope carrying a stable `code` and the `request_id` ' +
      'echoed in the `x-request-id` header. Unsafe requests must carry an allowed `Origin`.',
  },
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: '__Host-sid',
        description: 'HttpOnly session cookie set by sign-in; the browser attaches it itself.',
      },
    },
    schemas: {
      ErrorEnvelope: {
        type: 'object',
        required: ['code', 'message', 'request_id'],
        properties: {
          code: { type: 'string', enum: ERROR_CODES },
          message: { type: 'string' },
          details: {},
          request_id: { type: 'string' },
        },
      },
      User: userSchema,
      Department: departmentSchema,
      RoomSummary: roomSummarySchema,
      RoomFeature: roomFeatureSchema,
      Room: roomSchema,
      ViewerBooking: viewerBookingSchema,
    },
  },
  paths: {
    '/api/v1/auth/sign-in': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in with employee code and password',
        description:
          'Employee code is the only accepted sign-in identity. On success sets the `__Host-sid` session cookie.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: z.toJSONSchema(signInSchema, { io: 'input' }) },
          },
        },
        responses: {
          200: jsonResponse('Signed in', userWithDepartment),
          400: errorResponse('VALIDATION_FAILED — malformed body'),
          401: errorResponse('INVALID_CREDENTIALS — unknown employee code or wrong password'),
          403: errorResponse('ACCOUNT_DISABLED'),
          423: errorResponse(
            'ACCOUNT_LOCKED — 5 failures within 15 minutes; `details.locked_until`',
          ),
        },
      },
    },
    '/api/v1/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current user, department, and session expiry',
        security: sessionCookie,
        responses: {
          200: jsonResponse('The signed-in user', {
            type: 'object',
            required: ['user', 'department', 'session'],
            properties: {
              ...userWithDepartment.properties,
              session: {
                type: 'object',
                required: ['expires_at'],
                properties: { expires_at: bangkokTimestamp },
              },
            },
          }),
          ...unauthenticated,
        },
      },
    },
    '/api/auth/sign-out': {
      post: {
        tags: ['Auth'],
        summary: 'Sign out (better-auth)',
        security: sessionCookie,
        responses: { 200: { description: 'Session revoked, cookie cleared' } },
      },
    },
    '/api/auth/get-session': {
      get: {
        tags: ['Auth'],
        summary: 'Raw better-auth session, `null` body when signed out',
        security: sessionCookie,
        responses: { 200: { description: 'Session and user, or `null`' } },
      },
    },
    '/api/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change password (better-auth)',
        security: sessionCookie,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string' },
                  newPassword: { type: 'string' },
                  revokeOtherSessions: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Password changed' },
          400: { description: 'Wrong current password or invalid new password' },
        },
      },
    },
    '/api/v1/availability': {
      get: {
        tags: ['Availability'],
        summary: 'Room-by-room availability verdicts for a candidate slot',
        description: 'Always returns every active room with its verdict; it never filters.',
        security: sessionCookie,
        parameters: [
          {
            name: 'start',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
          },
          {
            name: 'end',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
          },
          { name: 'headcount', in: 'query', schema: { type: 'integer', minimum: 1 } },
          featuresParameter,
        ],
        responses: {
          200: jsonResponse('Verdict per active room', {
            type: 'object',
            required: ['start', 'end', 'rooms'],
            properties: {
              start: bangkokTimestamp,
              end: bangkokTimestamp,
              rooms: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['room', 'available', 'reasons'],
                  properties: {
                    room: { $ref: '#/components/schemas/RoomSummary' },
                    available: { type: 'boolean' },
                    reasons: {
                      type: 'array',
                      items: {
                        type: 'string',
                        enum: ['BUSY', 'CLOSED', 'HOLIDAY', 'CAPACITY', 'MISSING_FEATURE'],
                      },
                    },
                    busy_until: bangkokTimestamp,
                  },
                },
              },
            },
          }),
          400: errorResponse('VALIDATION_FAILED'),
          ...unauthenticated,
          422: errorResponse(
            'Hard scheduling-window violation (OUTSIDE_BUSINESS_HOURS, MIN_DURATION, …)',
          ),
        },
      },
    },
    '/api/v1/calendar': {
      get: {
        tags: ['Availability'],
        summary: 'Bookings, business hours, and holidays for a date range',
        security: sessionCookie,
        parameters: [
          {
            name: 'from',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date' },
            description: 'Bangkok calendar date (YYYY-MM-DD), inclusive',
          },
          {
            name: 'to',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date' },
            description: 'Bangkok calendar date (YYYY-MM-DD), inclusive; range is 1–31 days',
          },
          { name: 'room_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: jsonResponse('Calendar facts for the range', {
            type: 'object',
            required: ['from', 'to', 'rooms', 'business_hours', 'holidays', 'bookings'],
            properties: {
              from: { type: 'string', format: 'date' },
              to: { type: 'string', format: 'date' },
              rooms: { type: 'array', items: { $ref: '#/components/schemas/RoomSummary' } },
              business_hours: {
                type: 'array',
                description: 'Only the weekday rows occurring in [from, to]',
                items: {
                  type: 'object',
                  required: ['weekday', 'is_open', 'open_time', 'close_time'],
                  properties: {
                    weekday: { type: 'integer', description: 'ISO weekday, 1 = Monday' },
                    is_open: { type: 'boolean' },
                    open_time: { type: ['string', 'null'] },
                    close_time: { type: ['string', 'null'] },
                  },
                },
              },
              holidays: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['date', 'name'],
                  properties: {
                    date: { type: 'string', format: 'date' },
                    name: { type: 'string' },
                  },
                },
              },
              bookings: {
                type: 'array',
                items: {
                  allOf: [
                    { $ref: '#/components/schemas/ViewerBooking' },
                    {
                      type: 'object',
                      properties: {
                        owner_display_name: {
                          type: 'string',
                          description:
                            'Display name of the employee who owns the reservation. Omitted from private BUSY views for FACILITY; private meeting titles and details remain masked.',
                        },
                      },
                    },
                  ],
                },
              },
            },
          }),
          400: errorResponse('VALIDATION_FAILED — malformed dates or range outside 1–31 days'),
          ...unauthenticated,
          404: errorResponse('NOT_FOUND — unknown `room_id`'),
        },
      },
    },
    '/api/v1/rooms': {
      get: {
        tags: ['Rooms'],
        summary: 'List rooms',
        security: sessionCookie,
        parameters: [
          { name: 'capacity_min', in: 'query', schema: { type: 'integer', minimum: 1 } },
          featuresParameter,
          {
            name: 'include_inactive',
            in: 'query',
            schema: { type: 'string', enum: ['true', 'false'] },
            description: 'ADMIN only',
          },
        ],
        responses: {
          200: jsonResponse('Rooms sorted by capacity then name', {
            type: 'object',
            required: ['data'],
            properties: {
              data: { type: 'array', items: { $ref: '#/components/schemas/Room' } },
            },
          }),
          400: errorResponse('VALIDATION_FAILED'),
          ...unauthenticated,
          403: errorResponse('FORBIDDEN — `include_inactive` without the ADMIN role'),
        },
      },
    },
    '/api/v1/rooms/{id}': {
      get: {
        tags: ['Rooms'],
        summary: 'Room detail',
        security: sessionCookie,
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: jsonResponse('The room', { $ref: '#/components/schemas/Room' }),
          ...unauthenticated,
          404: errorResponse('NOT_FOUND — unknown id, or inactive room for a non-ADMIN viewer'),
        },
      },
    },
    '/api/v1/rooms/{id}/photo': {
      get: {
        tags: ['Rooms'],
        summary: 'Room photo',
        security: sessionCookie,
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'The photo',
            content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
          },
          ...unauthenticated,
          404: errorResponse('NOT_FOUND — unknown room or no photo'),
        },
      },
    },
    '/api/healthz': {
      get: {
        tags: ['Ops'],
        summary: 'Liveness probe',
        responses: { 200: { description: '`{"status":"ok"}` without touching dependencies' } },
      },
    },
    '/api/readyz': {
      get: {
        tags: ['Ops'],
        summary: 'Readiness probe (checks the database)',
        responses: {
          200: { description: '`{"status":"ready"}`' },
          503: { description: '`{"status":"not_ready"}` when the database is unreachable' },
        },
      },
    },
  },
};
