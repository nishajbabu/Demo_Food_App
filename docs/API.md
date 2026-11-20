# GaonGo API reference

Base URL: `http://localhost:4000` locally. All bodies are JSON. After login, send
`Authorization: Bearer <token>`. Money is always in **paise** (`pricePaise: 24500` = Rs 245).
Errors come back as `{ "error": "message for the user" }` with a 4xx/5xx status.

## Public
| Method | Path | What it does |
| --- | --- | --- |
| GET | `/health` | Server is up |
| GET | `/config` | Which services are live, support phone, delivery fee rules, whether UPI is on |
| GET | `/villages` | Villages to pick at sign-up |
| POST | `/auth/request-otp` | `{ phone }` → sends SMS code (`devOtp` returned in development) |
| POST | `/auth/verify-otp` | `{ phone, otp, app: customer\|partner\|admin, name? }` → `{ token, user }` |

## Any logged-in user
| Method | Path | What it does |
| --- | --- | --- |
| GET / PATCH | `/auth/me` | Read / update name, village, landmark, language |
| GET | `/merchants?type=food\|grocery\|dairy` | Approved shops in my cluster |
| GET | `/merchants/:id` | One shop with its products |
| GET | `/search?q=atta` | Products across shops in my cluster |
| GET | `/places` | Pickup/drop spots for rides |
| POST | `/support/tickets` | `{ subject, category, message, orderId? }` |
| GET | `/support/tickets/mine`, `/support/tickets/:id` | My tickets, with replies |
| POST | `/support/tickets/:id/messages` | Add a message |

## Customer (`role = customer`)
| Method | Path | What it does |
| --- | --- | --- |
| POST | `/orders` | `{ merchantId, items:[{productId, qty}], paymentMethod: cod\|upi, addressText?, note? }` |
| GET | `/orders/mine`, `/orders/:id` | My orders; one order with status timeline and delivery OTP |
| POST | `/orders/:id/cancel` | Cancel while `placed` or `accepted` |
| POST | `/orders/:id/pay` | Get a UPI payment link (Razorpay) |
| GET | `/subscriptions/products` | Subscribable products + earliest start date |
| GET / POST | `/subscriptions/mine`, `/subscriptions` | List / create `{ productId, qty, frequency, slot, startDate? }` |
| POST | `/subscriptions/:id/skip` | `{ date, skip: true\|false }` |
| PATCH | `/subscriptions/:id` | `{ qty?, slot?, status: active\|paused\|cancelled }` |
| GET | `/subscriptions/:id/bill?month=YYYY-MM` | Deliveries and total for a month |
| GET | `/rides/estimate?pickupPlaceId&dropPlaceId` | Fare for each vehicle type |
| POST | `/rides` | `{ vehicleType, pickupPlaceId, dropPlaceId, paymentMethod }` |
| GET | `/rides/mine`, `/rides/:id` | My rides and share-auto seats; one ride with OTP and driver |
| POST | `/rides/:id/cancel`, `/rides/:id/sos` | Cancel; emergency ticket to support |
| GET | `/share/routes`, `/share/trips?routeId=` | Share-auto routes and upcoming departures with free seats |
| POST | `/share/trips/:id/book`, `/share/bookings/:id/cancel` | Book `{ seats }` / cancel |

## Shop (`role = merchant`)
| Method | Path | What it does |
| --- | --- | --- |
| GET / PATCH | `/merchant/me` | My shop + today's numbers / `{ isOpen }` |
| GET | `/merchant/orders?view=active\|history` | Orders with items, customer, rider, pickup code |
| POST | `/merchant/orders/:id/accept` \| `reject` \| `ready` | Move the order on |
| GET / POST / PATCH | `/merchant/products`, `/merchant/products/:id` | Items, prices, stock |
| GET | `/merchant/subscriptions/sheet?date=` | Delivery sheet for a day, with totals |
| POST | `/merchant/subscription-deliveries/:id` | `{ status: delivered\|missed\|scheduled }` |
| GET | `/merchant/subscriptions/dues?month=` | What each home owes this month |
| POST | `/merchant/subscriptions/payments` | Record `{ customerId, month, amountPaise, method }` |

## Delivery rider (`role = rider`)
| Method | Path | What it does |
| --- | --- | --- |
| GET | `/rider/me`, `/rider/tasks` | Earnings, cash in hand; my deliveries + nearby offers |
| PATCH | `/rider/status` | `{ online?, lat?, lng? }` |
| POST | `/rider/orders/:id/accept` \| `picked-up` \| `delivered` | Delivered needs `{ otp }` |
| GET | `/rider/history?date=` | Deliveries on a day |

## Driver (`role = driver`)
| Method | Path | What it does |
| --- | --- | --- |
| GET | `/driver/me`, `/driver/requests` | Pass, earnings; ride requests + my current ride |
| PATCH | `/driver/status` | `{ online?, lat?, lng? }` |
| POST | `/driver/pass` | Record today's daily pass |
| POST | `/driver/rides/:id/accept` \| `start` \| `complete` \| `cancel` | Start needs `{ otp }` |
| GET / POST | `/driver/routes`, `/driver/share-trips` | Routes; my departures / add `{ routeId, departsAt, seatsTotal }` |
| POST | `/driver/share-trips/:id/walkins` \| `start` \| `complete` \| `cancel` | Walk-ins `{ delta: 1\|-1 }` |

## Ops team (`role = admin` or `support`; ★ = admin only)
| Method | Path | What it does |
| --- | --- | --- |
| GET | `/admin/stats` | Today's numbers |
| GET | `/admin/orders?status=active\|delivered\|cancelled\|all&service=` | Orders |
| GET | `/admin/orders/:id` | One order with timeline and refunds |
| POST | `/admin/orders/:id/assign` \| `cancel` \| `refund` | `{ riderId }` / `{ reason }` / `{ amountPaise, reason }` |
| GET / POST | `/admin/refunds`, `/admin/refunds/:id/done` | Refunds to pay back |
| GET / POST★ / PATCH★ | `/admin/merchants` | List, sign up, approve / suspend shops |
| GET / POST★ | `/admin/partners` | Riders & drivers (with cash in hand), add one |
| PATCH★ | `/admin/users/:id` | `{ isActive }` block / unblock |
| GET | `/admin/users?phone=` | Find a person |
| POST | `/admin/cash/:riderId/settle` | Cash handed over `{ amountPaise }` |
| GET | `/admin/subscriptions?date=`, `/admin/rides` | Subscription deliveries per dairy; recent rides |
| GET / POST | `/admin/tickets`, `/admin/tickets/:id`, `/admin/tickets/:id/messages` | Support queue and replies |
| POST | `/admin/tickets` | Log a phone/WhatsApp complaint `{ phone, subject, message, ... }` |
| POST | `/admin/tickets/:id/resolve` \| `reopen` | Close / reopen |
| GET / PATCH★ | `/admin/settings` | `{ services: { grocery, milk, food, rides } }` |
| GET / POST★ | `/admin/villages` | Villages and clusters |

## Webhook
| Method | Path | What it does |
| --- | --- | --- |
| POST | `/payments/razorpay/webhook` | Razorpay `payment_link.paid` → marks the order paid (signature checked) |
