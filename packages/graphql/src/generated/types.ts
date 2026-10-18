export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** An extended ISO 8601 date string in the format YYYY-MM-DD. */
  AWSDate: { input: string; output: string; }
  /**
   * An extended ISO 8601 date and time string in the format YYYY-MM-DDThh:mm:ss.sssZ.
   * Evaluated in or normalized to Asia/Colombo (UTC+05:30) for statutory records.
   */
  AWSDateTime: { input: string; output: string; }
  /** An RFC 5322 compliant email address string. */
  AWSEmail: { input: string; output: string; }
  /** An IPv4 or IPv6 network address string. */
  AWSIPAddress: { input: string; output: string; }
  /** A string containing serialized JSON data. */
  AWSJSON: { input: string; output: string; }
  /** An E.164 compliant phone number string (e.g. +94771234567 for Sri Lankan mobile). */
  AWSPhone: { input: string; output: string; }
  /** An extended ISO 8601 time string in the format hh:mm:ss.sss. */
  AWSTime: { input: string; output: string; }
  /** An integer value representing seconds past unix epoch (1970-01-01T00:00:00Z). */
  AWSTimestamp: { input: number; output: number; }
  /** An RFC 3986 compliant Uniform Resource Locator string. */
  AWSURL: { input: string; output: string; }
};

/** Input for posting a charge to an open folio. */
export type AddFolioChargeInput = {
  department: Department;
  description: Scalars['String']['input'];
  folioId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
  serviceOrderId?: InputMaybe<Scalars['ID']['input']>;
  unitPriceLkr: Scalars['Float']['input'];
};

/** Immutable audit trail action types for tamper-evident SHA-256 event chaining. */
export enum AuditAction {
  /** New record inserted. */
  Create = 'CREATE',
  /** Record deleted or soft-deleted. */
  Delete = 'DELETE',
  /** Financial payment recorded or folio settled. */
  PaymentRecorded = 'PAYMENT_RECORDED',
  /** Security violation, authentication failure, or token mismatch. */
  SecurityAlert = 'SECURITY_ALERT',
  /** State machine or lifecycle status transition. */
  StatusChange = 'STATUS_CHANGE',
  /** Existing record updated. */
  Update = 'UPDATE'
}

/** Ayurveda & Wellness Appointment modeling traditional Sri Lankan herbal medicine and spa treatments. */
export type AyurvedaAppointment = {
  __typename?: 'AyurvedaAppointment';
  /** Scheduled therapy date. */
  appointmentDate: Scalars['AWSDate']['output'];
  /** Sequential appointment reference code (e.g. 'AYU-2026-0341'). */
  appointmentNumber: Scalars['String']['output'];
  /** Timestamp of appointment booking. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Treatment duration in minutes (e.g. 60, 90, 120). */
  durationMinutes: Scalars['Int']['output'];
  /** Treatment scheduled end time. */
  endTime: Scalars['AWSTime']['output'];
  /** Optional room folio identifier if billed to room. */
  folioId: Maybe<Scalars['ID']['output']>;
  /** Guest full name receiving therapy. */
  guestName: Scalars['String']['output'];
  /** Guest health contraindications, skin sensitivities, or medical notes. */
  healthNotesOrAllergies: Maybe<Scalars['String']['output']>;
  /** List of traditional herbal oils prescribed or applied (e.g. ['Mahanarayana Taila', 'Pinda Taila']). */
  herbalOilsUsed: Maybe<Array<Scalars['String']['output']>>;
  /** Unique appointment identifier. */
  id: Scalars['ID']['output'];
  /** Flag indicating whether treatment was posted to guest room folio. */
  isBilledToFolio: Scalars['Boolean']['output'];
  /** Net treatment rate before statutory taxes in LKR. */
  rateLkr: Scalars['Float']['output'];
  /** Linked in-house room reservation ID. */
  reservationId: Maybe<Scalars['ID']['output']>;
  /** Room number of the guest. */
  roomNumber: Maybe<Scalars['String']['output']>;
  /** Treatment start time. */
  startTime: Scalars['AWSTime']['output'];
  /** Appointment status ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'). */
  status: Scalars['String']['output'];
  /** Itemized 4-stage compounding statutory taxes (SC -> TDL -> SSCL -> VAT). */
  taxBreakdown: TaxBreakdown;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Assigned certified Ayurvedic therapist or physician. */
  therapistName: Maybe<Scalars['String']['output']>;
  /** Total gross charge in Sri Lankan Rupees. */
  totalGrossLkr: Scalars['Float']['output'];
  /** Display name of the treatment (e.g. 'Traditional Shirodhara & Herbal Oil Bath'). */
  treatmentName: Scalars['String']['output'];
  /** Wellness treatment room or cabana identifier. */
  treatmentRoomId: Maybe<Scalars['String']['output']>;
  /** Therapy category ('SHIRODHARA', 'ABHYANGA_MASSAGE', 'HERBAL_STEAM_BATH', 'PINDA_SWEDA', 'CONSULTATION', 'PANCHAKARMA_PACKAGE'). */
  treatmentType: Scalars['String']['output'];
  /** Timestamp of latest appointment update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/**
 * Banquet Event Order (BEO) modeling Sri Lankan traditional weddings, homecomings, and galas.
 * Captures auspicious times (Poruwa/Ashtaka Nekath), corkage fees, and bite plates.
 */
export type BanquetEvent = {
  __typename?: 'BanquetEvent';
  /** Actual attendees on the event day. */
  actualGuestCount: Maybe<Scalars['Int']['output']>;
  /** Total advance deposit collected. */
  advanceDepositPaidLkr: Scalars['Float']['output'];
  /** Auspicious time for Jayamangala Gatha / Ashtaka chanting. */
  ashtakaChantingTime: Maybe<Scalars['AWSTime']['output']>;
  /** Remaining balance due. */
  balanceDueLkr: Scalars['Float']['output'];
  /** Finger food and bites itemized list. */
  bitePlates: Maybe<Array<BitePlateItem>>;
  /** Bride and groom names for wedding functions. */
  brideAndGroomNames: Maybe<Scalars['String']['output']>;
  /** Client contact email. */
  clientEmail: Scalars['AWSEmail']['output'];
  /** Primary booking client name. */
  clientName: Scalars['String']['output'];
  /** Client contact phone. */
  clientPhone: Scalars['AWSPhone']['output'];
  /** Number of outside alcohol bottles brought. */
  corkageBottleCount: Maybe<Scalars['Int']['output']>;
  /** Total corkage charge for outside liquor / wine bottles. */
  corkageFeeTotalLkr: Scalars['Float']['output'];
  /** Timestamp of creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Scheduled end time. */
  endTime: Scalars['AWSTime']['output'];
  /** Date of the banquet function. */
  eventDate: Scalars['AWSDate']['output'];
  /** Sequential event serial number (e.g. 'BEO-2026-0048'). */
  eventNumber: Scalars['String']['output'];
  /** Event category ('TRADITIONAL_SINHALA_WEDDING', 'HINDU_WEDDING', 'HOMECOMING', 'CORPORATE_GALA'). */
  eventType: Scalars['String']['output'];
  /** Master function folio identifier. */
  folioId: Maybe<Scalars['ID']['output']>;
  /** Guaranteed minimum guest covers. */
  guaranteedGuestCount: Scalars['Int']['output'];
  /** Expanded hall venue details. */
  hall: Maybe<BanquetHall>;
  /** Assigned banquet hall identifier. */
  hallId: Scalars['ID']['output'];
  /** Hall rental venue hire charge in LKR. */
  hallRentalChargeLkr: Scalars['Float']['output'];
  /** Unique BEO identifier. */
  id: Scalars['ID']['output'];
  /** Agreed per-plate catering rate in Sri Lankan Rupees. */
  perPlateRateLkr: Scalars['Float']['output'];
  /** Auspicious time for traditional Poruwa ceremony (Nekatha). */
  poruwaCeremonyTime: Maybe<Scalars['AWSTime']['output']>;
  /** Selected wedding buffet menu package name. */
  selectedMenuPackageName: Scalars['String']['output'];
  /** Table decor, floral Poruwa setup, and DJ audio instructions. */
  setupNotes: Maybe<Scalars['String']['output']>;
  /** Function timing slot ('DAY_SLOT', 'NIGHT_SLOT', 'FULL_DAY'). */
  slot: Scalars['String']['output'];
  /** Scheduled start time. */
  startTime: Scalars['AWSTime']['output'];
  /** Function status ('TENTATIVE', 'CONFIRMED', 'IN_PROGRESS', 'CONCLUDED', 'CANCELLED'). */
  status: Scalars['String']['output'];
  /** Net function subtotal prior to service charge and statutory taxes. */
  subtotalLkr: Scalars['Float']['output'];
  /** Full 4-stage tax compounding itemization (SC -> TDL -> SSCL -> VAT). */
  taxBreakdown: TaxBreakdown;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Grand gross payable amount for event order in LKR. */
  totalGrossLkr: Scalars['Float']['output'];
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Banquet hall, ballroom, or garden function venue with slot management. */
export type BanquetHall = {
  __typename?: 'BanquetHall';
  /** Timestamp of creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Venue facilities and AV features. */
  features: Array<Scalars['String']['output']>;
  /** Unique banquet venue identifier. */
  id: Scalars['ID']['output'];
  /** Whether venue is active and bookable. */
  isActive: Scalars['Boolean']['output'];
  /** Maximum seated dining capacity. */
  maxSeatingCapacity: Scalars['Int']['output'];
  /** Venue hall name (e.g. 'Grand Ballroom', 'Lotus Pavilion', 'Beachfront Lawn'). */
  name: Scalars['String']['output'];
  /** Standard rental rate per function slot in Sri Lankan Rupees. */
  rentalRateLkr: Scalars['Float']['output'];
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Cocktail finger food / bite plate item for Sri Lankan banquet and wedding functions. */
export type BitePlateItem = {
  __typename?: 'BitePlateItem';
  /** Unique bite plate identifier. */
  id: Scalars['ID']['output'];
  /** Display name of bite dish (e.g. 'Hot Butter Cuttlefish', 'Devilled Cashew & Chicken'). */
  name: Scalars['String']['output'];
  /** Quantity ordered in Kilograms or Plates. */
  quantityKgOrPlates: Scalars['Float']['output'];
  /** Agreed rate per unit in LKR. */
  ratePerUnitLkr: Scalars['Float']['output'];
  /** Total amount in LKR for this item. */
  totalAmountLkr: Scalars['Float']['output'];
  /** Unit of measurement ('KG', 'PORTIONS', 'PLATES'). */
  unitOfMeasure: Scalars['String']['output'];
};

/** Input for cocktail bite plate items. */
export type BitePlateItemInput = {
  name: Scalars['String']['input'];
  quantityKgOrPlates: Scalars['Float']['input'];
  ratePerUnitLkr: Scalars['Float']['input'];
  unitOfMeasure: Scalars['String']['input'];
};

/** Hospitality property classification under Sri Lanka Tourism Development Authority (SLTDA). */
export enum BusinessType {
  /** Coastal resort property with direct beach frontage or lagoon access. */
  BeachResort = 'BEACH_RESORT',
  /** Exclusive low-density boutique luxury villa or private estate. */
  BoutiqueVilla = 'BOUTIQUE_VILLA',
  /** Full-service urban commercial hotel with 24/7 reception and banqueting. */
  CityHotel = 'CITY_HOTEL',
  /** Eco-friendly nature lodge or wildlife safari tented retreat. */
  EcoLodge = 'ECO_LODGE',
  /** Modern tourist guest house or bed & breakfast (under 10 rooms). */
  GuestHouse = 'GUEST_HOUSE',
  /** Traditional Sri Lankan heritage bungalow or hill-country tea plantation bungalow. */
  HeritageBungalow = 'HERITAGE_BUNGALOW',
  /** Government or private rest house catering to domestic and transit travelers. */
  RestHouse = 'REST_HOUSE',
  /** Serviced apartment or long-stay holiday residence. */
  ServicedApartment = 'SERVICED_APARTMENT'
}

/** Input for front desk guest check-in with statutory identity verification. */
export type CheckInGuestInput = {
  assignedRoomId: Scalars['ID']['input'];
  driverAccommodation?: InputMaybe<DriverAccommodationInput>;
  guestNationality?: InputMaybe<Scalars['String']['input']>;
  guestNic?: InputMaybe<Scalars['String']['input']>;
  guestPassportNumber?: InputMaybe<Scalars['String']['input']>;
  reservationId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
  touristPoliceBCardNumber?: InputMaybe<Scalars['String']['input']>;
};

/** Unified activity booking input covering both safari excursions and Ayurveda therapies. */
export type CreateActivityBookingInput = {
  /** Category discriminator ('EXCURSION' or 'AYURVEDA'). */
  activityCategory: Scalars['String']['input'];
  /** Ayurveda appointment details when category is 'AYURVEDA'. */
  ayurvedaInput?: InputMaybe<CreateAyurvedaAppointmentInput>;
  /** Excursion details when category is 'EXCURSION'. */
  excursionInput?: InputMaybe<CreateExcursionBookingInput>;
};

/** Input for scheduling an Ayurveda or indigenous wellness therapy appointment. */
export type CreateAyurvedaAppointmentInput = {
  appointmentDate: Scalars['AWSDate']['input'];
  chargeToFolio?: InputMaybe<Scalars['Boolean']['input']>;
  durationMinutes: Scalars['Int']['input'];
  guestName: Scalars['String']['input'];
  healthNotesOrAllergies?: InputMaybe<Scalars['String']['input']>;
  herbalOilsUsed?: InputMaybe<Array<Scalars['String']['input']>>;
  rateLkr: Scalars['Float']['input'];
  reservationId?: InputMaybe<Scalars['ID']['input']>;
  roomNumber?: InputMaybe<Scalars['String']['input']>;
  startTime: Scalars['AWSTime']['input'];
  therapistName?: InputMaybe<Scalars['String']['input']>;
  treatmentName: Scalars['String']['input'];
  treatmentRoomId?: InputMaybe<Scalars['String']['input']>;
  treatmentType: Scalars['String']['input'];
};

/** Input for creating a Banquet Event Order (BEO). */
export type CreateBanquetEventInput = {
  ashtakaChantingTime?: InputMaybe<Scalars['AWSTime']['input']>;
  bitePlates?: InputMaybe<Array<BitePlateItemInput>>;
  brideAndGroomNames?: InputMaybe<Scalars['String']['input']>;
  clientEmail: Scalars['AWSEmail']['input'];
  clientName: Scalars['String']['input'];
  clientPhone: Scalars['AWSPhone']['input'];
  corkageBottleCount?: InputMaybe<Scalars['Int']['input']>;
  corkageFeeTotalLkr: Scalars['Float']['input'];
  endTime: Scalars['AWSTime']['input'];
  eventDate: Scalars['AWSDate']['input'];
  eventType: Scalars['String']['input'];
  guaranteedGuestCount: Scalars['Int']['input'];
  hallId: Scalars['ID']['input'];
  hallRentalChargeLkr: Scalars['Float']['input'];
  perPlateRateLkr: Scalars['Float']['input'];
  poruwaCeremonyTime?: InputMaybe<Scalars['AWSTime']['input']>;
  selectedMenuPackageName: Scalars['String']['input'];
  setupNotes?: InputMaybe<Scalars['String']['input']>;
  slot: Scalars['String']['input'];
  startTime: Scalars['AWSTime']['input'];
};

/** Input for booking an excursion, safari jeep, whale watching, or transfer tour. */
export type CreateExcursionBookingInput = {
  activityType: Scalars['String']['input'];
  chargeToFolio?: InputMaybe<Scalars['Boolean']['input']>;
  departureTime: Scalars['AWSTime']['input'];
  driverContactPhone?: InputMaybe<Scalars['AWSPhone']['input']>;
  driverOrGuideName?: InputMaybe<Scalars['String']['input']>;
  dropoffLocation: Scalars['String']['input'];
  excursionDate: Scalars['AWSDate']['input'];
  guestName: Scalars['String']['input'];
  guestPhone: Scalars['AWSPhone']['input'];
  numberOfAdults: Scalars['Int']['input'];
  numberOfChildren?: InputMaybe<Scalars['Int']['input']>;
  pickupLocation: Scalars['String']['input'];
  reservationId?: InputMaybe<Scalars['ID']['input']>;
  retailRateLkr: Scalars['Float']['input'];
  returnTime?: InputMaybe<Scalars['AWSTime']['input']>;
  roomNumber?: InputMaybe<Scalars['String']['input']>;
  specialRequirements?: InputMaybe<Scalars['String']['input']>;
  supplierCostLkr?: InputMaybe<Scalars['Float']['input']>;
  title: Scalars['String']['input'];
  vehicleRegistrationNo?: InputMaybe<Scalars['String']['input']>;
};

/** Input for issuing stock from central stores to kitchen/bar outlets. */
export type CreateGoodsIssueNoteInput = {
  destinationDepartment: Department;
  destinationLocation: Scalars['String']['input'];
  issueDate: Scalars['AWSDate']['input'];
  items: Array<GinItemInput>;
  remarks?: InputMaybe<Scalars['String']['input']>;
  sourceLocation: Scalars['String']['input'];
};

/** Input for creating a multi-room group tour booking. */
export type CreateGroupBookingInput = {
  checkInDate: Scalars['AWSDate']['input'];
  checkOutDate: Scalars['AWSDate']['input'];
  groupName: Scalars['String']['input'];
  notes?: InputMaybe<Scalars['String']['input']>;
  primaryContactEmail: Scalars['AWSEmail']['input'];
  primaryContactName: Scalars['String']['input'];
  primaryContactPhone: Scalars['AWSPhone']['input'];
  totalGuests: Scalars['Int']['input'];
  totalRoomsBooked: Scalars['Int']['input'];
  tourOperatorContractId?: InputMaybe<Scalars['ID']['input']>;
};

/** Input for creating a new individual or tour reservation. */
export type CreateReservationInput = {
  adultsCount: Scalars['Int']['input'];
  assignedRoomId?: InputMaybe<Scalars['ID']['input']>;
  checkInDate: Scalars['AWSDate']['input'];
  checkOutDate: Scalars['AWSDate']['input'];
  childrenCount: Scalars['Int']['input'];
  driverAccommodation?: InputMaybe<DriverAccommodationInput>;
  flightDetails?: InputMaybe<Scalars['String']['input']>;
  groupBookingId?: InputMaybe<Scalars['ID']['input']>;
  guestEmail: Scalars['AWSEmail']['input'];
  guestName: Scalars['String']['input'];
  guestNationality?: InputMaybe<Scalars['String']['input']>;
  guestNic?: InputMaybe<Scalars['String']['input']>;
  guestPassportNumber?: InputMaybe<Scalars['String']['input']>;
  guestPhone: Scalars['AWSPhone']['input'];
  mealPlan: MealPlan;
  quotedRateAmount: Scalars['Float']['input'];
  quotedRateCurrency: Scalars['String']['input'];
  rateTier: ResidencyRateTier;
  roomTypeId: Scalars['ID']['input'];
  specialRequests?: InputMaybe<Scalars['String']['input']>;
  tourOperatorContractId?: InputMaybe<Scalars['ID']['input']>;
  tourVoucherNumber?: InputMaybe<Scalars['String']['input']>;
};

/** Input for submitting a new contactless QR or waiter POS service order. */
export type CreateServiceOrderInput = {
  diningType: DiningType;
  guestNotes?: InputMaybe<Scalars['String']['input']>;
  items: Array<OrderLineItemInput>;
  reservationId?: InputMaybe<Scalars['ID']['input']>;
  roomNumber?: InputMaybe<Scalars['String']['input']>;
  tableNumber?: InputMaybe<Scalars['String']['input']>;
};

/** Input for configuring a split-folio routing rule. */
export type CreateSplitFolioRoutingInput = {
  billToTourOperatorContractId?: InputMaybe<Scalars['ID']['input']>;
  department?: InputMaybe<Department>;
  fixedAmountLkr?: InputMaybe<Scalars['Float']['input']>;
  folioId: Scalars['ID']['input'];
  percentage?: InputMaybe<Scalars['Float']['input']>;
  targetFolioType: Scalars['String']['input'];
};

/** Hotel operating departments for task allocation, kitchen routing, and service charge distribution. */
export enum Department {
  /** Finance, night audit, cashiering, and revenue management. */
  Accounts = 'ACCOUNTS',
  /** Banquet sales, event coordination, and function floor operations. */
  Banquet = 'BANQUET',
  /** Main lounge bar, pool bar, and beverage dispense. */
  Bar = 'BAR',
  /** Front Office, reception, reservations, concierge, and guest relations. */
  FrontOffice = 'FRONT_OFFICE',
  /** Housekeeping, linen management, laundry, and room inspection. */
  Housekeeping = 'HOUSEKEEPING',
  /** Main hot kitchen, pantry, pastry, and prep stations. */
  Kitchen = 'KITCHEN',
  /** Engineering, facilities maintenance, and utilities monitoring. */
  Maintenance = 'MAINTENANCE',
  /** General management, executive office, and SaaS tenant administration. */
  Management = 'MANAGEMENT',
  /** Food & Beverage dining room, table service, and banquet service. */
  Restaurant = 'RESTAURANT',
  /** Property security, loss prevention, and gate pass management. */
  Security = 'SECURITY',
  /** Ayurveda wellness pavilion, therapeutic spa, and herbal treatment suites. */
  Spa = 'SPA',
  /** Driver quarters, chauffeur lounge, and transport coordination. */
  Transport = 'TRANSPORT'
}

/** Dining channel classification for KDS routing, BOT printing, and Service Charge rules. */
export enum DiningType {
  /** Banquet function, wedding buffet, or corporate conference dining. */
  BanquetService = 'BANQUET_SERVICE',
  /** Private beach cabana or romantic dinner setup. */
  BeachCabana = 'BEACH_CABANA',
  /** Contactless guest ordering directly from guest room via room QR token. */
  InRoomDining = 'IN_ROOM_DINING',
  /** Poolside sun lounger or outdoor terrace service. */
  PoolSide = 'POOL_SIDE',
  /** Staff canteen or complimentary crew dining. */
  StaffDining = 'STAFF_DINING',
  /** Dine-in table service in hotel restaurant or dining pavilion. */
  TableService = 'TABLE_SERVICE',
  /** Takeaway or packed lunch for safari / day excursion. */
  Takeaway = 'TAKEAWAY'
}

/** Input for calculating and disbursing the monthly 10% Service Charge pool to staff. */
export type DistributeStaffScPoolInput = {
  breakageReserveDeductionPct: Scalars['Float']['input'];
  month: Scalars['Int']['input'];
  year: Scalars['Int']['input'];
};

/** Chauffeur / Tour Driver accommodation record linked to a guest reservation or group tour. */
export type DriverAccommodation = {
  __typename?: 'DriverAccommodation';
  /** Check-in date for driver quarters. */
  checkInDate: Scalars['AWSDate']['output'];
  /** Check-out date for driver quarters. */
  checkOutDate: Scalars['AWSDate']['output'];
  /** Nightly fee in LKR (0.00 if complimentary). */
  costPerNightLkr: Scalars['Float']['output'];
  /** Timestamp of check-in. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Expanded dorm bed details. */
  driverDormBed: Maybe<DriverDormBed>;
  /** Assigned driver dorm bed identifier. */
  driverDormBedId: Scalars['ID']['output'];
  /** Full name of the chauffeur / tour guide. */
  driverName: Scalars['String']['output'];
  /** Sri Lankan National Identity Card (NIC) number. */
  driverNic: Scalars['String']['output'];
  /** Contact phone number for emergency concierge dispatch. */
  driverPhone: Scalars['AWSPhone']['output'];
  /** Unique driver accommodation assignment identifier. */
  id: Scalars['ID']['output'];
  /** Whether accommodation is complimentary under DMC contract. */
  isComplimentary: Scalars['Boolean']['output'];
  /** Meal arrangement provided for driver (e.g. BB or FB). */
  mealEntitlement: Maybe<MealPlan>;
  /** Parent guest reservation identifier. */
  reservationId: Scalars['ID']['output'];
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
  /** Vehicle registration number (e.g. 'WP-CAD-8921'). */
  vehicleNumber: Scalars['String']['output'];
};

/** Input for chauffeur accommodation assignment. */
export type DriverAccommodationInput = {
  checkInDate: Scalars['AWSDate']['input'];
  checkOutDate: Scalars['AWSDate']['input'];
  costPerNightLkr?: InputMaybe<Scalars['Float']['input']>;
  driverDormBedId: Scalars['ID']['input'];
  driverName: Scalars['String']['input'];
  driverNic: Scalars['String']['input'];
  driverPhone: Scalars['AWSPhone']['input'];
  isComplimentary: Scalars['Boolean']['input'];
  mealEntitlement?: InputMaybe<MealPlan>;
  vehicleNumber: Scalars['String']['input'];
};

/**
 * Dedicated chauffeur accommodation bed in staff/driver quarters.
 * Essential for Sri Lankan round-trip DMC and private guide logistics.
 */
export type DriverDormBed = {
  __typename?: 'DriverDormBed';
  /** Room number of the tourist guest the driver is escorting. */
  associatedGuestRoomNumber: Maybe<Scalars['String']['output']>;
  /** Physical bed / cubicle number (e.g. 'DORM-01', 'CHAUFFEUR-B4'). */
  bedNumber: Scalars['String']['output'];
  /** Timestamp of creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Full name of the currently staying driver / chauffeur. */
  currentDriverName: Maybe<Scalars['String']['output']>;
  /** National Identity Card (NIC) number of the staying chauffeur. */
  currentDriverNic: Maybe<Scalars['String']['output']>;
  /** Contact mobile number of the staying chauffeur. */
  currentDriverPhone: Maybe<Scalars['AWSPhone']['output']>;
  /** Associated tour operator or DMC account identifier. */
  currentTourOperatorId: Maybe<Scalars['ID']['output']>;
  /** Dormitory wing or building section. */
  dormSection: Scalars['String']['output'];
  /** Unique dorm bed identifier. */
  id: Scalars['ID']['output'];
  /** Whether driver accommodation is provided complimentary. */
  isComplimentary: Scalars['Boolean']['output'];
  /** Whether this dorm bed is currently occupied. */
  isOccupied: Scalars['Boolean']['output'];
  /** Special notes (e.g. early safari departure, meal preferences). */
  notes: Maybe<Scalars['String']['output']>;
  /** Nightly bed charge in LKR (or 0.00 if complimentary under DMC agreement). */
  ratePerNightLkr: Scalars['Float']['output'];
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Excursion Booking covering Sri Lankan wildlife safaris, whale watching, cultural tours, and airport transfers. */
export type ExcursionBooking = {
  __typename?: 'ExcursionBooking';
  /** Category of excursion ('SAFARI_JEEP', 'WHALE_WATCHING', 'CULTURAL_TOUR', 'AIRPORT_TRANSFER', 'TEA_PLANTATION', 'BOAT_SAFARI', 'HIKING_TREK'). */
  activityType: Scalars['String']['output'];
  /** Sequential excursion booking reference number (e.g. 'EXC-2026-0129'). */
  bookingNumber: Scalars['String']['output'];
  /** Timestamp of booking creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Scheduled departure time from the hotel lobby. */
  departureTime: Scalars['AWSTime']['output'];
  /** Contact phone number of the driver or guide. */
  driverContactPhone: Maybe<Scalars['AWSPhone']['output']>;
  /** Name of assigned driver, naturalist, or tour guide. */
  driverOrGuideName: Maybe<Scalars['String']['output']>;
  /** Dropoff destination or return point. */
  dropoffLocation: Scalars['String']['output'];
  /** Scheduled date of the excursion. */
  excursionDate: Scalars['AWSDate']['output'];
  /** Optional room folio identifier if billed to guest room. */
  folioId: Maybe<Scalars['ID']['output']>;
  /** Primary guest full name. */
  guestName: Scalars['String']['output'];
  /** Guest contact phone in E.164 format. */
  guestPhone: Scalars['AWSPhone']['output'];
  /** Unique excursion booking identifier. */
  id: Scalars['ID']['output'];
  /** Whether the charge has been transferred to the guest stay folio. */
  isBilledToFolio: Scalars['Boolean']['output'];
  /** Number of adult participants. */
  numberOfAdults: Scalars['Int']['output'];
  /** Number of child participants. */
  numberOfChildren: Scalars['Int']['output'];
  /** Pickup departure point. */
  pickupLocation: Scalars['String']['output'];
  /** Optional linked hotel stay reservation identifier. */
  reservationId: Maybe<Scalars['ID']['output']>;
  /** Retail price charged to guest prior to statutory taxes in LKR. */
  retailRateLkr: Scalars['Float']['output'];
  /** Estimated or actual return time to the hotel. */
  returnTime: Maybe<Scalars['AWSTime']['output']>;
  /** Room number if the guest is an in-house resident. */
  roomNumber: Maybe<Scalars['String']['output']>;
  /** Special guest requirements (e.g. packed breakfast box, child booster seat, wildlife lens). */
  specialRequirements: Maybe<Scalars['String']['output']>;
  /** Booking operational status ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'). */
  status: Scalars['String']['output'];
  /** Net supplier / operator wholesale cost in Sri Lankan Rupees. */
  supplierCostLkr: Scalars['Float']['output'];
  /** Itemized 4-stage compounding statutory taxes (SC -> TDL -> SSCL -> VAT). */
  taxBreakdown: TaxBreakdown;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Descriptive activity title (e.g. 'Yala National Park Afternoon Safari Jeep 4x4'). */
  title: Scalars['String']['output'];
  /** Grand gross payable amount in Sri Lankan Rupees. */
  totalGrossLkr: Scalars['Float']['output'];
  /** Timestamp of latest booking update. */
  updatedAt: Scalars['AWSDateTime']['output'];
  /** Vehicle registration number (e.g. 'WP NC-7744'). */
  vehicleRegistrationNo: Maybe<Scalars['String']['output']>;
};

/** FIFO stock batch tracking unit cost, GRN origin, and shelf-life expiration. */
export type FifoBatch = {
  __typename?: 'FifoBatch';
  /** Unique batch identifier within stock item. */
  batchId: Scalars['String']['output'];
  /** Perishable food/beverage or chemical expiry date. */
  expiryDate: Maybe<Scalars['AWSDate']['output']>;
  /** Goods Received Note number referencing the batch intake. */
  grnNumber: Scalars['String']['output'];
  /** Initial quantity received upon GRN posting. */
  initialQuantity: Scalars['Float']['output'];
  /** Goods receipt date. */
  receivedDate: Scalars['AWSDate']['output'];
  /** Remaining unconsumed quantity in store. */
  remainingQuantity: Scalars['Float']['output'];
  /** Supplier name or trade partner. */
  supplierName: Maybe<Scalars['String']['output']>;
  /** Cost per unit of measure in LKR at time of receipt. */
  unitCostLkr: Scalars['Float']['output'];
};

/** Guest or Tour Operator ledger folio aggregating line item charges, taxes, and settlements. */
export type Folio = {
  __typename?: 'Folio';
  /** Outstanding balance due in LKR. */
  balanceDueLkr: Scalars['Float']['output'];
  /** Timestamp of creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Settlement currency. */
  currency: Scalars['String']['output'];
  /** Official folio serial number (e.g. 'FOL-2026-00412'). */
  folioNumber: Scalars['String']['output'];
  /** Folio billing channel ('MAIN', 'GUEST_EXTRAS', 'DMC_CITY_LEDGER'). */
  folioType: Scalars['String']['output'];
  /** Unique folio identifier. */
  id: Scalars['ID']['output'];
  /** Generated official tax invoice identifier once settled. */
  invoiceId: Maybe<Scalars['ID']['output']>;
  /** Whether folio is fully balanced and settled. */
  isSettled: Scalars['Boolean']['output'];
  /** Active and historical line item postings. */
  lineItems: Array<FolioLineItem>;
  /** Associated reservation identifier. */
  reservationId: Scalars['ID']['output'];
  /** Timestamp of final settlement. */
  settledAt: Maybe<Scalars['AWSDateTime']['output']>;
  /** Active split routing rules configured for this folio. */
  splitRouting: Maybe<Array<SplitFolioRouting>>;
  /** Current lifecycle and settlement status. */
  status: FolioStatus;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Sum of net supply bases across all active line items. */
  totalBaseSupplyLkr: Scalars['Float']['output'];
  /** Grand total gross payable amount in Sri Lankan Rupees. */
  totalGrossLkr: Scalars['Float']['output'];
  /** Total payments and credits applied against this folio. */
  totalPaidLkr: Scalars['Float']['output'];
  /** Sum of 10% Service Charge across all active line items. */
  totalServiceChargeLkr: Scalars['Float']['output'];
  /** Sum of 2.5641% SSCL across all active line items. */
  totalSsclLkr: Scalars['Float']['output'];
  /** Sum of 1% TDL across all active line items. */
  totalTdlLkr: Scalars['Float']['output'];
  /** Sum of 18% VAT across all active line items. */
  totalVatLkr: Scalars['Float']['output'];
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/**
 * Official Sri Lankan Inland Revenue Department (IRD) Tax Invoice issued on folio settlement.
 * Cryptographically sealed with SHA-256 hash chaining.
 */
export type FolioInvoice = {
  __typename?: 'FolioInvoice';
  /** Invoice settlement currency ('LKR' or 'USD'). */
  currency: Scalars['String']['output'];
  /** CBSL benchmark conversion rate applied for foreign currency invoices. */
  exchangeRateToLkr: Scalars['Float']['output'];
  /** Settled folio identifier. */
  folioId: Scalars['ID']['output'];
  /** Billed party billing address. */
  guestAddress: Maybe<Scalars['String']['output']>;
  /** Billed party legal name (Guest or Tour Operator). */
  guestName: Scalars['String']['output'];
  /** Guest NIC (Sri Lankan resident) or Passport Number (foreign tourist). */
  guestNicOrPassport: Maybe<Scalars['String']['output']>;
  /** SHA-256 tamper-evident hash chaining value. */
  hashChainSha256: Scalars['String']['output'];
  /** Unique invoice identifier. */
  id: Scalars['ID']['output'];
  /** Statutory sequential tax invoice number (e.g. 'INV-2026-00084'). */
  invoiceNumber: Scalars['String']['output'];
  /** Timestamp of official tax invoice issuance. */
  issuedAt: Scalars['AWSDateTime']['output'];
  /** Central Bank LankaQR EMVCo dynamic merchant payment payload string. */
  lankaQrPayload: Maybe<Scalars['String']['output']>;
  /** Final settlement payment instrument. */
  paymentMethod: PaymentMethod;
  /** Merchant gateway or bank transaction reference. */
  paymentReference: Maybe<Scalars['String']['output']>;
  /** Comprehensive 4-stage compounding tax itemization. */
  taxBreakdown: TaxBreakdown;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Hotel IRD 9-digit Tax Identification Number. */
  tinNo: Scalars['String']['output'];
  /** Gross invoice amount in foreign currency if contracted in USD/EUR. */
  totalGrossForeign: Maybe<Scalars['Float']['output']>;
  /** Gross invoice amount in Sri Lankan Rupees. */
  totalGrossLkr: Scalars['Float']['output'];
  /** Hotel IRD 12-digit VAT Registration Number. */
  vatRegNo: Maybe<Scalars['String']['output']>;
};

/** Granular line item charged to a guest or DMC folio with full 4-stage tax compounding. */
export type FolioLineItem = {
  __typename?: 'FolioLineItem';
  /** Total net supply base in LKR (quantity * unitPriceLkr). */
  baseSupplyLkr: Scalars['Float']['output'];
  /** Timestamp when charge was posted. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Originating department (Front Desk, Restaurant POS, KDS, Bar, Spa). */
  department: Department;
  /** Itemized description (e.g. 'Deluxe Room Night', 'Devilled Prawns KOT #42'). */
  description: Scalars['String']['output'];
  /** Parent folio identifier. */
  folioId: Scalars['ID']['output'];
  /** Unique line item identifier. */
  id: Scalars['ID']['output'];
  /** Whether this charge has been voided by a manager. */
  isVoided: Scalars['Boolean']['output'];
  /** Quantity consumed. */
  quantity: Scalars['Int']['output'];
  /** Originating KDS or QR service order identifier if applicable. */
  serviceOrderId: Maybe<Scalars['ID']['output']>;
  /** Full itemized 4-stage tax and service charge compounding breakdown. */
  taxBreakdown: TaxBreakdown;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Final gross billable amount inclusive of service charge and taxes. */
  totalGrossLkr: Scalars['Float']['output'];
  /** Unit price in LKR prior to service charge and taxes. */
  unitPriceLkr: Scalars['Float']['output'];
  /** Audit justification for charge reversal or void. */
  voidReason: Maybe<Scalars['String']['output']>;
};

/** Guest folio settlement status. */
export enum FolioStatus {
  /** Active open folio accepting room charges, F&B orders, and payments. */
  Open = 'OPEN',
  /** Fully settled folio with zero balance, locked for editing. */
  Settled = 'SETTLED',
  /** Charges transferred to master company folio or DMC City Ledger. */
  Transferred = 'TRANSFERRED',
  /** Voided or reversed folio under managerial audit control. */
  Voided = 'VOIDED'
}

/** Input for generating an SLTDA monthly statistical return. */
export type GenerateSltdaMonthlyReturnInput = {
  month: Scalars['Int']['input'];
  year: Scalars['Int']['input'];
};

/** Input for generating an IRD/SLTDA quarterly TDL calculation summary. */
export type GenerateTdlQuarterlySummaryInput = {
  quarter: Scalars['Int']['input'];
  taxYear: Scalars['Int']['input'];
};

/** Input line item for Goods Issue Notes (GIN) or kitchen requisitions. */
export type GinItemInput = {
  quantityIssued: Scalars['Float']['input'];
  stockItemId: Scalars['ID']['input'];
};

/** Input line item for recording Goods Received Notes (GRN). */
export type GrnItemInput = {
  expiryDate?: InputMaybe<Scalars['AWSDate']['input']>;
  quantityReceived: Scalars['Float']['input'];
  stockItemId: Scalars['ID']['input'];
  unitCostLkr: Scalars['Float']['input'];
};

/** Multi-room group reservation or DMC coach tour series. */
export type GroupBooking = {
  __typename?: 'GroupBooking';
  /** Group arrival date. */
  checkInDate: Scalars['AWSDate']['output'];
  /** Group departure date. */
  checkOutDate: Scalars['AWSDate']['output'];
  /** Timestamp of creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Group tour reference name (e.g. 'German Photographic Tour - Oct 2026'). */
  groupName: Scalars['String']['output'];
  /** Unique group booking identifier. */
  id: Scalars['ID']['output'];
  /** Master group folio identifier for consolidated charges. */
  masterFolioId: Maybe<Scalars['ID']['output']>;
  /** Special banquet, meal, or baggage handling instructions. */
  notes: Maybe<Scalars['String']['output']>;
  /** Organizer contact email. */
  primaryContactEmail: Scalars['AWSEmail']['output'];
  /** Lead tour leader / organizer name. */
  primaryContactName: Scalars['String']['output'];
  /** Organizer contact phone number. */
  primaryContactPhone: Scalars['AWSPhone']['output'];
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Total adult and child guests in group party. */
  totalGuests: Scalars['Int']['output'];
  /** Total count of allocated rooms across room types. */
  totalRoomsBooked: Scalars['Int']['output'];
  /** Expanded tour operator contract details. */
  tourOperatorContract: Maybe<TourOperatorContract>;
  /** Associated tour operator contract if booked via DMC. */
  tourOperatorContractId: Maybe<Scalars['ID']['output']>;
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Multi-tenant hotel property configuration representing a distinct hotel, resort, or villa. */
export type HotelTenant = {
  __typename?: 'HotelTenant';
  /** Physical postal street address. */
  address: Scalars['String']['output'];
  /** High-resolution banner hero image URL for guest QR portal (16:9). */
  bannerUrl: Maybe<Scalars['AWSURL']['output']>;
  /** SLTDA property classification tier. */
  businessType: BusinessType;
  /** Official CBSL benchmark or hotel locked USD-to-LKR buying exchange rate. */
  cbslUsdRateLkr: Scalars['Float']['output'];
  /** City or town in Sri Lanka. */
  city: Scalars['String']['output'];
  /** ISO timestamp of tenant creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Base accounting currency (defaults to 'LKR'). */
  currency: Scalars['String']['output'];
  /** Official contact email address. */
  email: Scalars['AWSEmail']['output'];
  /** Unique SaaS tenant identifier (e.g. 'tenant-sigiriya-luxury-001'). */
  id: Scalars['ID']['output'];
  /** Central Bank of Sri Lanka (CBSL) LankaQR EMVCo merchant identifier. */
  lankaQrMerchantId: Maybe<Scalars['String']['output']>;
  /** Square brand mark or logo image URL for folios, receipts, and KDS (1:1). */
  logoUrl: Maybe<Scalars['AWSURL']['output']>;
  /** Display property trade name. */
  name: Scalars['String']['output'];
  /** Main contact telephone / mobile number in E.164 format. */
  phone: Scalars['AWSPhone']['output'];
  /** Sri Lankan postal code. */
  postalCode: Maybe<Scalars['String']['output']>;
  /** Official Sri Lanka Tourism Development Authority registration reference. */
  sltdaRegNo: Maybe<Scalars['String']['output']>;
  /** Statutory Sri Lankan tax calculation configuration for this property. */
  taxConfig: TaxConfig;
  /** Sri Lankan Inland Revenue Department 9-digit Tax Identification Number. */
  tinNo: Maybe<Scalars['String']['output']>;
  /** ISO timestamp of tenant configuration update. */
  updatedAt: Scalars['AWSDateTime']['output'];
  /** Sri Lankan Inland Revenue Department 12-digit VAT registration number. */
  vatRegNo: Maybe<Scalars['String']['output']>;
};

/** Room and public area housekeeping turnover status for Apple HIG PMS tape chart. */
export enum HousekeepingStatus {
  /** Clean, sanitized, and ready for immediate guest check-in. */
  Clean = 'CLEAN',
  /** Occupied or checked-out room requiring full changeover and linen refresh. */
  Dirty = 'DIRTY',
  /** Do Not Disturb active — guest requested privacy. */
  DoNotDisturb = 'DO_NOT_DISTURB',
  /** Inspected and certified by housekeeping supervisor / executive housekeeper. */
  Inspected = 'INSPECTED',
  /** Blocked for major refurbishment, water damage, or electrical works. */
  OutOfOrder = 'OUT_OF_ORDER',
  /** Temporarily blocked for deep cleaning, pest control, or minor repair. */
  OutOfService = 'OUT_OF_SERVICE',
  /** Quick freshen-up / evening turndown service required. */
  TouchUp = 'TOUCH_UP'
}

/** Inventory movement voucher modeling PR (Purchase Requisition), GRN (Goods Received Note), GIN (Goods Issue Note), and Stock Adjustments. */
export type InventoryVoucher = {
  __typename?: 'InventoryVoucher';
  /** User identifier of storekeeper or chef authorising the transaction. */
  authorizedByUserId: Scalars['ID']['output'];
  /** Timestamp of voucher creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Operating department associated with the movement. */
  department: Department;
  /** Destination department or kitchen station (e.g. 'Main Kitchen Hot Line', 'Pool Bar'). */
  destinationLocation: Maybe<Scalars['String']['output']>;
  /** Unique inventory voucher identifier. */
  id: Scalars['ID']['output'];
  /** Itemized list of stock SKUs moved in this voucher. */
  items: Array<InventoryVoucherItem>;
  /** Linked purchase order number for GRN intake. */
  poNumber: Maybe<Scalars['String']['output']>;
  /** Auditable remarks, supplier delivery note number, or reason for breakage/adjustment. */
  remarks: Maybe<Scalars['String']['output']>;
  /** Origin warehouse or store bin (e.g. 'Central Stores', 'Receiving Dock'). */
  sourceLocation: Maybe<Scalars['String']['output']>;
  /** Supplier name for GRN intake vouchers. */
  supplierName: Maybe<Scalars['String']['output']>;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Total valuation of items moved in LKR. */
  totalValueLkr: Scalars['Float']['output'];
  /** Timestamp of latest voucher update. */
  updatedAt: Scalars['AWSDateTime']['output'];
  /** Date of inventory transaction. */
  voucherDate: Scalars['AWSDate']['output'];
  /** Sequential voucher reference code (e.g. 'GRN-2026-0145', 'GIN-2026-0072'). */
  voucherNumber: Scalars['String']['output'];
  /** Movement category ('GRN_GOODS_RECEIVED_NOTE', 'GIN_GOODS_ISSUE_NOTE', 'PURCHASE_REQUISITION', 'STOCK_ADJUSTMENT', 'WASTAGE_OR_BREAKAGE'). */
  voucherType: Scalars['String']['output'];
};

/** Inventory Voucher line item detailing stock movement and valuation. */
export type InventoryVoucherItem = {
  __typename?: 'InventoryVoucherItem';
  /** Quantity moved, received, or issued. */
  quantity: Scalars['Float']['output'];
  /** Stock item identifier. */
  stockItemId: Scalars['ID']['output'];
  /** Item display name. */
  stockItemName: Scalars['String']['output'];
  /** Stock Keeping Unit code. */
  stockItemSku: Scalars['String']['output'];
  /** Total line movement valuation in LKR. */
  totalCostLkr: Scalars['Float']['output'];
  /** Cost per unit of measure in LKR. */
  unitCostLkr: Scalars['Float']['output'];
  /** Unit of measure. */
  unitOfMeasure: Scalars['String']['output'];
};

/** Standard international and Sri Lankan hotel meal plan arrangements. */
export enum MealPlan {
  /** All Inclusive — All meals, local beverages, and selected excursions included. */
  Ai = 'AI',
  /** Bed & Breakfast — Continental or Sri Lankan breakfast included. */
  Bb = 'BB',
  /** Full Board — American Plan (Breakfast, Lunch, and Dinner included). */
  Fb = 'FB',
  /** Half Board — Modified American Plan (Breakfast and Dinner included). */
  Hb = 'HB',
  /** Room Only — European Plan (no meals included). */
  Ro = 'RO'
}

/** Menu section grouping (e.g. 'Traditional Sri Lankan Curries', 'Ceylon Seafood', 'Desserts'). */
export type MenuCategory = {
  __typename?: 'MenuCategory';
  /** Timestamp of creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Target department (KITCHEN, BAR). */
  department: Department;
  /** Trilingual section description. */
  description: Maybe<TrilingualText>;
  /** Applicable dining channels for this category. */
  diningTypes: Array<DiningType>;
  /** Display sort sequence. */
  displayOrder: Scalars['Int']['output'];
  /** Unique category identifier. */
  id: Scalars['ID']['output'];
  /** Whether category is visible on guest menu. */
  isActive: Scalars['Boolean']['output'];
  /** Child menu items under this category. */
  items: Maybe<Array<MenuItem>>;
  /** Trilingual category title. */
  name: TrilingualText;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Individual food, beverage, or room service menu item. */
export type MenuItem = {
  __typename?: 'MenuItem';
  /** Parent menu category identifier. */
  categoryId: Scalars['ID']['output'];
  /** Stock keeping or POS dish short code (e.g. 'KOT-402'). */
  code: Scalars['String']['output'];
  /** Timestamp of creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Target department for BOT / KDS order routing (KITCHEN, BAR). */
  department: Department;
  /** Trilingual culinary description. */
  description: TrilingualText;
  /** Display sort sequence. */
  displayOrder: Scalars['Int']['output'];
  /** Unique menu item identifier. */
  id: Scalars['ID']['output'];
  /** High-resolution square 1:1 image URL for Apple HIG guest QR ordering. */
  imageUrl: Maybe<Scalars['AWSURL']['output']>;
  /** Whether item is currently in stock and available on QR ordering. */
  isAvailable: Scalars['Boolean']['output'];
  /** Dietary classification: Gluten-free. */
  isGlutenFree: Scalars['Boolean']['output'];
  /** Dietary classification: Halal certified. */
  isHalal: Scalars['Boolean']['output'];
  /** Dietary classification: Vegan. */
  isVegan: Scalars['Boolean']['output'];
  /** Dietary classification: Vegetarian. */
  isVegetarian: Scalars['Boolean']['output'];
  /** Physical kitchen station (e.g. 'Hot Wok', 'Pantry', 'Curry Station', 'Grill'). */
  kitchenStation: Maybe<Scalars['String']['output']>;
  /** Customization modifier groups. */
  modifiers: Maybe<Array<ModifierOption>>;
  /** Menu selling price in Sri Lankan Rupees prior to service charge and statutory tax. */
  priceLkr: Scalars['Float']['output'];
  /** Recipe Bill of Materials ingredients for automatic FIFO inventory depletion. */
  recipeBom: Maybe<Array<RecipeBomIngredient>>;
  /** Sri Lankan spice heat rating (0 = Mild, 1 = Medium, 2 = Hot, 3 = Sri Lankan Extra Hot). */
  spicyLevel: Scalars['Int']['output'];
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Trilingual dish title. */
  title: TrilingualText;
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Dish customization modifier (e.g. Spice level, Rice type, Salad dressing, Add-ons). */
export type ModifierOption = {
  __typename?: 'ModifierOption';
  /** Unique modifier identifier. */
  id: Scalars['ID']['output'];
  /** Whether selected by default in QR ordering. */
  isDefault: Scalars['Boolean']['output'];
  /** Trilingual modifier option name. */
  name: TrilingualText;
  /** Price surcharge in LKR (0.00 for no charge). */
  priceAdjustmentLkr: Scalars['Float']['output'];
};

/** Input for dish modifier option. */
export type ModifierOptionInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  isDefault: Scalars['Boolean']['input'];
  name: TrilingualTextInput;
  priceAdjustmentLkr: Scalars['Float']['input'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /** Posts an F&B, minibar, laundry, or extra charge to an active folio. */
  addFolioCharge: Maybe<Folio>;
  /** Checks in a guest with room allocation and statutory identity records (NIC / Tourist Police B-Card). */
  checkInGuest: Maybe<Reservation>;
  /** Checks out a guest and vacates the room. */
  checkOutGuest: Maybe<Reservation>;
  /** Creates a unified activity booking (excursion or Ayurveda). */
  createActivityBooking: Maybe<Scalars['Boolean']['output']>;
  /** Schedules an Ayurveda wellness therapy or doctor consultation appointment. */
  createAyurvedaAppointment: Maybe<AyurvedaAppointment>;
  /** Creates a banquet event or wedding function sheet (BEO). */
  createBanquetEvent: Maybe<BanquetEvent>;
  /** Creates a safari, whale watching, or cultural excursion booking. */
  createExcursionBooking: Maybe<ExcursionBooking>;
  /** Issues stock items from central store to department or kitchen outlet via Goods Issue Note (GIN). */
  createGoodsIssueNote: Maybe<InventoryVoucher>;
  /** Creates a multi-room group tour booking. */
  createGroupBooking: Maybe<GroupBooking>;
  /** Creates a new guest room reservation. */
  createReservation: Maybe<Reservation>;
  /** Places a contactless QR room service order or waiter table service order. */
  createServiceOrder: Maybe<ServiceOrder>;
  /** Configures split routing for a reservation folio. */
  createSplitFolioRouting: Maybe<Folio>;
  /** Calculates and distributes monthly 10% Service Charge pool shares with breakage and EPF. */
  distributeStaffScPool: Maybe<StaffScPoolStatement>;
  /** Compiles and validates an SLTDA monthly statistical occupancy and revenue return. */
  generateSltdaMonthlyReturn: Maybe<SltdaMonthlyReturn>;
  /** Calculates quarterly Tourism Development Levy (TDL) liability for IRD compliance. */
  generateTdlQuarterlySummary: Maybe<TdlQuarterlySummary>;
  /** Health check ping mutation for AppSync real-time subscriptions. */
  ping: Scalars['String']['output'];
  /** Records received inventory stock into FIFO batches via Goods Received Note (GRN). */
  recordGrn: Maybe<InventoryVoucher>;
  /** Executes the daily automated or manual night audit close and ledger rollover. */
  runNightAudit: Maybe<NightAuditReport>;
  /** Settles an outstanding folio and generates a sealed IRD tax invoice. */
  settleFolio: Maybe<FolioInvoice>;
  /** Quickly toggles item 86/out-of-stock availability from kitchen runner screen. */
  toggleMenuItemAvailability: Maybe<MenuItem>;
  /** Instant 1-tap inStock toggle for Kitchen KDS / Chef screen (<20ms). */
  toggleMenuItemStock: Maybe<MenuItem>;
  /** Updates appointment lifecycle status of an Ayurveda therapy session. */
  updateAyurvedaAppointmentStatus: Maybe<AyurvedaAppointment>;
  /** Updates the lifecycle status of a banquet event. */
  updateBanquetEventStatus: Maybe<BanquetEvent>;
  /** Updates operational status of an excursion booking. */
  updateExcursionStatus: Maybe<ExcursionBooking>;
  /** Kitchen chef or order expediter updates order status on KDS (Acknowledged, Ready, Delivered, Cancelled). */
  updateOrderStatus: Maybe<ServiceOrder>;
  /** Updates room housekeeping cleanliness state from staff runner tablet. */
  updateRoomHousekeepingStatus: Maybe<Room>;
  /** Real-time KDS transition mutation alias. */
  updateServiceOrderStatus: Maybe<ServiceOrder>;
  /** Creates or updates a banquet event or wedding function sheet (BEO) enforcing hall and time-slot uniqueness. */
  upsertBanquetEvent: Maybe<BanquetEvent>;
  /** Provisions or updates a banquet hall or lawn venue profile. */
  upsertBanquetHall: Maybe<BanquetHall>;
  /** Provisions or updates a chauffeur / tour driver dorm bed. */
  upsertDriverDormBed: Maybe<DriverDormBed>;
  /** Provisions or updates a hotel tenant profile, SLTDA registrations, and tax presets. */
  upsertHotelTenant: Maybe<HotelTenant>;
  /** Creates or updates a trilingual menu category. */
  upsertMenuCategory: Maybe<MenuCategory>;
  /** Creates or updates a dish or beverage item with BOM costing and modifier options. */
  upsertMenuItem: Maybe<MenuItem>;
  /** Creates or updates a physical room's metadata and inventory allocation. */
  upsertRoom: Maybe<Room>;
  /** Creates or updates a room type and its seasonal rate bands. */
  upsertRoomType: Maybe<RoomType>;
  /** Provisions or edits a stock inventory item, par level, and replenishment settings. */
  upsertStockItem: Maybe<StockItem>;
  /** Creates or updates a Tour Operator / DMC credit contract. */
  upsertTourOperatorContract: Maybe<TourOperatorContract>;
  /** Managerially voids an erroneously posted folio line item with audit justification. */
  voidFolioCharge: Maybe<Folio>;
};


export type MutationAddFolioChargeArgs = {
  input: AddFolioChargeInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationCheckInGuestArgs = {
  input: CheckInGuestInput;
};


export type MutationCheckOutGuestArgs = {
  reservationId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateActivityBookingArgs = {
  input: CreateActivityBookingInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateAyurvedaAppointmentArgs = {
  input: CreateAyurvedaAppointmentInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateBanquetEventArgs = {
  input: CreateBanquetEventInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateExcursionBookingArgs = {
  input: CreateExcursionBookingInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateGoodsIssueNoteArgs = {
  input: CreateGoodsIssueNoteInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateGroupBookingArgs = {
  input: CreateGroupBookingInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateReservationArgs = {
  input: CreateReservationInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateServiceOrderArgs = {
  input: CreateServiceOrderInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateSplitFolioRoutingArgs = {
  input: CreateSplitFolioRoutingInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationDistributeStaffScPoolArgs = {
  input: DistributeStaffScPoolInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationGenerateSltdaMonthlyReturnArgs = {
  input: GenerateSltdaMonthlyReturnInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationGenerateTdlQuarterlySummaryArgs = {
  input: GenerateTdlQuarterlySummaryInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationRecordGrnArgs = {
  input: RecordGrnInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationRunNightAuditArgs = {
  input: RunNightAuditInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationSettleFolioArgs = {
  input: SettleFolioInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationToggleMenuItemAvailabilityArgs = {
  id: Scalars['ID']['input'];
  isAvailable: Scalars['Boolean']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationToggleMenuItemStockArgs = {
  id: Scalars['ID']['input'];
  inStock: Scalars['Boolean']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationUpdateAyurvedaAppointmentStatusArgs = {
  id: Scalars['ID']['input'];
  status: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationUpdateBanquetEventStatusArgs = {
  id: Scalars['ID']['input'];
  status: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationUpdateExcursionStatusArgs = {
  id: Scalars['ID']['input'];
  status: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationUpdateOrderStatusArgs = {
  input: UpdateOrderStatusInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpdateRoomHousekeepingStatusArgs = {
  roomId: Scalars['ID']['input'];
  status: HousekeepingStatus;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpdateServiceOrderStatusArgs = {
  input: UpdateOrderStatusInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpsertBanquetEventArgs = {
  input: UpsertBanquetEventInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpsertBanquetHallArgs = {
  input: UpsertBanquetHallInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpsertDriverDormBedArgs = {
  input: UpsertDriverDormBedInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpsertHotelTenantArgs = {
  input: UpsertHotelTenantInput;
};


export type MutationUpsertMenuCategoryArgs = {
  input: UpsertMenuCategoryInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpsertMenuItemArgs = {
  input: UpsertMenuItemInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpsertRoomArgs = {
  input: UpsertRoomInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpsertRoomTypeArgs = {
  input: UpsertRoomTypeInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpsertStockItemArgs = {
  input: UpsertStockItemInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpsertTourOperatorContractArgs = {
  input: UpsertTourOperatorContractInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationVoidFolioChargeArgs = {
  folioId: Scalars['ID']['input'];
  lineItemId: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};

/** Guest arrival and room-night count by country of residence for SLTDA statutory returns. */
export type NationalityGuestCount = {
  __typename?: 'NationalityGuestCount';
  /** ISO 3166-1 alpha-2 or alpha-3 country code. */
  countryCode: Scalars['String']['output'];
  /** English country name (e.g. 'United Kingdom', 'Germany', 'India', 'Sri Lanka'). */
  countryName: Scalars['String']['output'];
  /** Total guest arrivals from this nationality during the month. */
  guestCount: Scalars['Int']['output'];
  /** Total guest nights spent by residents of this nationality. */
  guestNights: Scalars['Int']['output'];
};

/** Daily Night Audit financial close, ledger balancing, and operational day rollover report. */
export type NightAuditReport = {
  __typename?: 'NightAuditReport';
  /** Business operating date audited. */
  auditDate: Scalars['AWSDate']['output'];
  /** Exact ISO timestamp when audit execution was triggered. */
  auditedAt: Scalars['AWSDateTime']['output'];
  /** User identifier of duty manager or night auditor. */
  auditorUserId: Scalars['ID']['output'];
  /** Timestamp of report generation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Count of unposted or unbalanced folio discrepancies identified. */
  folioDiscrepanciesCount: Scalars['Int']['output'];
  /** Unique night audit record identifier. */
  id: Scalars['ID']['output'];
  /** Whether the system business date rollover succeeded. */
  isRolloverSuccessful: Scalars['Boolean']['output'];
  /** Guest and city ledger closing balance in LKR. */
  ledgerClosingBalanceLkr: Scalars['Float']['output'];
  /** Guest and city ledger opening balance in LKR. */
  ledgerOpeningBalanceLkr: Scalars['Float']['output'];
  /** Auditor remarks and variance explanations. */
  notes: Maybe<Scalars['String']['output']>;
  /** Calculated property occupancy percentage. */
  occupancyPercentage: Scalars['Float']['output'];
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Total food and beverage net revenue in LKR. */
  totalFnBRevenueLkr: Scalars['Float']['output'];
  /** Total gross turnover before statutory deductions in LKR. */
  totalGrossRevenueLkr: Scalars['Float']['output'];
  /** Total other department net revenue (spa, excursions, laundry, banquets) in LKR. */
  totalOtherRevenueLkr: Scalars['Float']['output'];
  /** Total room accommodation net revenue in LKR. */
  totalRoomRevenueLkr: Scalars['Float']['output'];
  /** Total rentable rooms inventory on the audit date. */
  totalRoomsAvailable: Scalars['Int']['output'];
  /** Total rooms occupied during the night. */
  totalRoomsOccupied: Scalars['Int']['output'];
  /** Total 10% staff service charge collected across folios in LKR. */
  totalServiceChargeCollectedLkr: Scalars['Float']['output'];
  /** Total 2.5% Social Security Contribution Levy collected in LKR. */
  totalSsclCollectedLkr: Scalars['Float']['output'];
  /** Total 1.0% or 0.5% SLTDA Tourism Development Levy collected in LKR. */
  totalTdlCollectedLkr: Scalars['Float']['output'];
  /** Total 18% Value Added Tax collected in LKR. */
  totalVatCollectedLkr: Scalars['Float']['output'];
};

/** Itemized dish or beverage within a live KDS or Room Service order ticket. */
export type OrderLineItem = {
  __typename?: 'OrderLineItem';
  /** Stock/kitchen dish short code. */
  dishCode: Scalars['String']['output'];
  /** Dish title in English. */
  dishTitle: Scalars['String']['output'];
  /** Unique line item identifier. */
  id: Scalars['ID']['output'];
  /** Kitchen prep station. */
  kitchenStation: Maybe<Scalars['String']['output']>;
  /** Individual dish line preparation status. */
  lineStatus: OrderStatus;
  /** Expanded menu item details. */
  menuItem: Maybe<MenuItem>;
  /** Associated menu item identifier. */
  menuItemId: Scalars['ID']['output'];
  /** Quantity ordered. */
  quantity: Scalars['Int']['output'];
  /** Selected customer modifier options (e.g. ['Sri Lankan Spicy', 'Extra Papadam']). */
  selectedModifiers: Maybe<Array<Scalars['String']['output']>>;
  /** Specific dietary or allergy preparation notes. */
  specialNotes: Maybe<Scalars['String']['output']>;
  /** Unit price in LKR. */
  unitPriceLkr: Scalars['Float']['output'];
};

/** Input for an individual dish within a service order. */
export type OrderLineItemInput = {
  menuItemId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
  selectedModifiers?: InputMaybe<Array<Scalars['String']['input']>>;
  specialNotes?: InputMaybe<Scalars['String']['input']>;
};

/** Real-time Kitchen Display System (KDS) and Room Service order lifecycle status. */
export enum OrderStatus {
  /** Order received and acknowledged by the kitchen chef / expediter. */
  Acknowledged = 'ACKNOWLEDGED',
  /** Order rejected or cancelled prior to preparation with audit justification. */
  Cancelled = 'CANCELLED',
  /** Order successfully delivered to guest table or room. */
  Delivered = 'DELIVERED',
  /** Dishes currently being prepared or cooked on specific kitchen stations. */
  InPreparation = 'IN_PREPARATION',
  /** Order in transit with runner to guest room, cabana, or dining table. */
  InTransit = 'IN_TRANSIT',
  /** Order plated, checked, and ready for runner pickup / food server delivery. */
  ReadyForPickup = 'READY_FOR_PICKUP',
  /** Order submitted by guest QR or waiter POS, awaiting kitchen acknowledgment. */
  Submitted = 'SUBMITTED'
}

/** Settlement payment methods supported by the Sri Lankan PMS folio engine. */
export enum PaymentMethod {
  /** Direct bank wire transfer or Sri Lankan SLIPS / CEFT fast electronic transfer. */
  BankTransfer = 'BANK_TRANSFER',
  /** Foreign currency banknotes accepted and locked using CBSL exchange rate. */
  CashForeign = 'CASH_FOREIGN',
  /** Sri Lankan Rupee cash paid directly at cashier. */
  CashLkr = 'CASH_LKR',
  /** City Ledger billing to Destination Management Company (DMC) credit account. */
  CityLedgerDmc = 'CITY_LEDGER_DMC',
  /** Authorized management complimentary folio (Zero charge, non-taxable). */
  Complimentary = 'COMPLIMENTARY',
  /** Visa / Mastercard / Amex processed via POS terminal or merchant gateway. */
  CreditCard = 'CREDIT_CARD',
  /** Central Bank of Sri Lanka (CBSL) LankaQR EMVCo dynamic dynamic merchant payment. */
  LankaQr = 'LANKA_QR',
  /** PayHere Sri Lankan payment gateway (Cards, Genie, FriMi, eZ Cash, mCash). */
  Payhere = 'PAYHERE',
  /** WebXPay Sri Lankan payment gateway with recurring subscription support. */
  Webxpay = 'WEBXPAY'
}

/** Purchase Order issued to external suppliers for store replenishment. */
export type PurchaseOrder = {
  __typename?: 'PurchaseOrder';
  /** User identifier of authorising manager / purchasing manager. */
  approvedByUserId: Maybe<Scalars['ID']['output']>;
  /** Timestamp of purchase order creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Requesting department. */
  department: Department;
  /** Target delivery arrival date. */
  expectedDeliveryDate: Maybe<Scalars['AWSDate']['output']>;
  /** Unique purchase order identifier. */
  id: Scalars['ID']['output'];
  /** List of ordered inventory SKU line items. */
  items: Array<PurchaseOrderItem>;
  /** Date purchase order was generated. */
  orderDate: Scalars['AWSDate']['output'];
  /** Sequential PO reference number (e.g. 'PO-2026-0089'). */
  poNumber: Scalars['String']['output'];
  /** Procurement workflow status ('DRAFT', 'APPROVED', 'SENT_TO_SUPPLIER', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED'). */
  status: Scalars['String']['output'];
  /** Total purchase amount before statutory taxes in LKR. */
  subtotalLkr: Scalars['Float']['output'];
  /** Supplier contact telephone / mobile number. */
  supplierContactPhone: Maybe<Scalars['AWSPhone']['output']>;
  /** Supplier or vendor trade name. */
  supplierName: Scalars['String']['output'];
  /** Statutory tax breakdown (VAT, SSCL where applicable). */
  taxBreakdown: TaxBreakdown;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Grand gross payable amount to supplier in LKR. */
  totalGrossLkr: Scalars['Float']['output'];
  /** Timestamp of latest PO update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Purchase Order line item detailing ordered SKU, agreed rate, and line total. */
export type PurchaseOrderItem = {
  __typename?: 'PurchaseOrderItem';
  /** Quantity ordered. */
  quantityOrdered: Scalars['Float']['output'];
  /** Linked stock item identifier. */
  stockItemId: Scalars['ID']['output'];
  /** Item display name. */
  stockItemName: Scalars['String']['output'];
  /** Stock Keeping Unit code. */
  stockItemSku: Scalars['String']['output'];
  /** Total line cost before taxes in LKR. */
  totalAmountLkr: Scalars['Float']['output'];
  /** Unit of measure. */
  unitOfMeasure: Scalars['String']['output'];
  /** Agreed purchase unit rate in LKR. */
  unitPriceLkr: Scalars['Float']['output'];
};

export type Query = {
  __typename?: 'Query';
  /** API version ping for AppSync health check. */
  apiVersion: Scalars['String']['output'];
  /** Retrieves an Ayurveda appointment by identifier. */
  getAyurvedaAppointment: Maybe<AyurvedaAppointment>;
  /** Retrieves a banquet event function sheet (BEO) by identifier. */
  getBanquetEvent: Maybe<BanquetEvent>;
  /** Retrieves an excursion booking by identifier. */
  getExcursionBooking: Maybe<ExcursionBooking>;
  /** Retrieves a guest or DMC ledger folio with all line items and tax breakdown. */
  getFolio: Maybe<Folio>;
  /** Retrieves an issued IRD tax invoice by identifier. */
  getFolioInvoice: Maybe<FolioInvoice>;
  /** Single-query fetch returning master folio and all line items in one DynamoDB query. */
  getFolioWithLines: Maybe<Folio>;
  /** Retrieves a single group booking by identifier. */
  getGroupBooking: Maybe<GroupBooking>;
  /** Retrieves a hotel tenant configuration by its unique tenantId. */
  getHotelTenant: Maybe<HotelTenant>;
  /** Retrieves an inventory movement voucher (GRN, GIN, Adjustment) by identifier. */
  getInventoryVoucher: Maybe<InventoryVoucher>;
  /** Retrieves a single dish or beverage menu item by identifier. */
  getMenuItem: Maybe<MenuItem>;
  /** Retrieves a daily night audit rollover report by business date. */
  getNightAuditReport: Maybe<NightAuditReport>;
  /** Retrieves a purchase order by identifier. */
  getPurchaseOrder: Maybe<PurchaseOrder>;
  /** Retrieves a reservation by identifier. */
  getReservation: Maybe<Reservation>;
  /** Retrieves a single physical room by identifier. */
  getRoom: Maybe<Room>;
  /** Retrieves a specific room type by its identifier. */
  getRoomType: Maybe<RoomType>;
  /** Retrieves a live food/beverage service order ticket by identifier. */
  getServiceOrder: Maybe<ServiceOrder>;
  /** Retrieves an SLTDA monthly statistical return by year and month. */
  getSltdaMonthlyReturn: Maybe<SltdaMonthlyReturn>;
  /** Retrieves the 10% staff service charge monthly pool statement. */
  getStaffScPoolStatement: Maybe<StaffScPoolStatement>;
  /** Retrieves a stock item by identifier. */
  getStockItem: Maybe<StockItem>;
  /** Retrieves an IRD / SLTDA Tourism Development Levy quarterly summary. */
  getTdlQuarterlySummary: Maybe<TdlQuarterlySummary>;
  /** Queries active orders currently displayed on kitchen KDS or bar order screens by department. */
  listActiveOrdersByDepartment: Array<ServiceOrder>;
  /** Queries active orders currently displayed on kitchen KDS or bar order screens. */
  listActiveServiceOrders: Array<ServiceOrder>;
  /** Lists Ayurveda appointments optionally filtered by therapy date. */
  listAyurvedaAppointments: Array<AyurvedaAppointment>;
  /** Lists banquet events and weddings filtered optionally by event date. */
  listBanquetEvents: Array<BanquetEvent>;
  /** Lists banquet halls and outdoor lawn venues with guest capacities. */
  listBanquetHalls: Array<BanquetHall>;
  /** Lists all driver and chauffeur dorm beds for a property. */
  listDriverDormBeds: Array<DriverDormBed>;
  /** Lists excursion bookings optionally filtered by scheduled date. */
  listExcursionBookings: Array<ExcursionBooking>;
  /** Lists all folios associated with a reservation (e.g. Master DMC + Extras). */
  listFoliosForReservation: Array<Folio>;
  /** Lists inventory vouchers filtered by type and date range. */
  listInventoryVouchers: Array<InventoryVoucher>;
  /** Single-query menu catalog fetching all categories with nested menu items in 1 RRU read. */
  listMenuCatalog: Array<MenuCategory>;
  /** Lists active F&B menu categories with trilingual titles and dining channels. */
  listMenuCategories: Array<MenuCategory>;
  /** Lists menu items under a category or property with pricing, allergens, and dietary badges. */
  listMenuItems: Array<MenuItem>;
  /** Lists purchase orders optionally filtered by workflow status. */
  listPurchaseOrders: Array<PurchaseOrder>;
  /** Queries reservations with optional status and arrival date filtering. */
  listReservations: Array<Reservation>;
  /** Fetches all reservations overlapping a Tape Chart date window using GSI1 date range. */
  listReservationsByDateRange: Array<Reservation>;
  /** Lists all room types configured for a tenant property. */
  listRoomTypes: Array<RoomType>;
  /** Lists all physical rooms and live tape-chart statuses for a property. */
  listRooms: Array<Room>;
  /** Lists SLTDA monthly statistical returns optionally filtered by calendar year. */
  listSltdaMonthlyReports: Array<SltdaMonthlyReturn>;
  /** Lists inventory stock items filtered by department and category. */
  listStockItems: Array<StockItem>;
  /** Lists all Tour Operator / DMC credit contracts for a property. */
  listTourOperatorContracts: Array<TourOperatorContract>;
};


export type QueryGetAyurvedaAppointmentArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetBanquetEventArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetExcursionBookingArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetFolioArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetFolioInvoiceArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetFolioWithLinesArgs = {
  folioId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetGroupBookingArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetHotelTenantArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryGetInventoryVoucherArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetMenuItemArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetNightAuditReportArgs = {
  auditDate: Scalars['AWSDate']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetPurchaseOrderArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetReservationArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetRoomArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetRoomTypeArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetServiceOrderArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetSltdaMonthlyReturnArgs = {
  month: Scalars['Int']['input'];
  tenantId: Scalars['ID']['input'];
  year: Scalars['Int']['input'];
};


export type QueryGetStaffScPoolStatementArgs = {
  month: Scalars['Int']['input'];
  tenantId: Scalars['ID']['input'];
  year: Scalars['Int']['input'];
};


export type QueryGetStockItemArgs = {
  id: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryGetTdlQuarterlySummaryArgs = {
  quarter: Scalars['Int']['input'];
  taxYear: Scalars['Int']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryListActiveOrdersByDepartmentArgs = {
  department: Department;
  tenantId: Scalars['ID']['input'];
};


export type QueryListActiveServiceOrdersArgs = {
  department?: InputMaybe<Department>;
  diningType?: InputMaybe<DiningType>;
  tenantId: Scalars['ID']['input'];
};


export type QueryListAyurvedaAppointmentsArgs = {
  appointmentDate?: InputMaybe<Scalars['AWSDate']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryListBanquetEventsArgs = {
  eventDate?: InputMaybe<Scalars['AWSDate']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryListBanquetHallsArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryListDriverDormBedsArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryListExcursionBookingsArgs = {
  excursionDate?: InputMaybe<Scalars['AWSDate']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryListFoliosForReservationArgs = {
  reservationId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryListInventoryVouchersArgs = {
  fromDate?: InputMaybe<Scalars['AWSDate']['input']>;
  tenantId: Scalars['ID']['input'];
  toDate?: InputMaybe<Scalars['AWSDate']['input']>;
  voucherType?: InputMaybe<Scalars['String']['input']>;
};


export type QueryListMenuCatalogArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryListMenuCategoriesArgs = {
  department?: InputMaybe<Department>;
  tenantId: Scalars['ID']['input'];
};


export type QueryListMenuItemsArgs = {
  categoryId?: InputMaybe<Scalars['ID']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryListPurchaseOrdersArgs = {
  status?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryListReservationsArgs = {
  checkInDate?: InputMaybe<Scalars['AWSDate']['input']>;
  status?: InputMaybe<ReservationStatus>;
  tenantId: Scalars['ID']['input'];
};


export type QueryListReservationsByDateRangeArgs = {
  endDate: Scalars['AWSDate']['input'];
  startDate: Scalars['AWSDate']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryListRoomTypesArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryListRoomsArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryListSltdaMonthlyReportsArgs = {
  tenantId: Scalars['ID']['input'];
  year?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryListStockItemsArgs = {
  category?: InputMaybe<Scalars['String']['input']>;
  department?: InputMaybe<Department>;
  tenantId: Scalars['ID']['input'];
};


export type QueryListTourOperatorContractsArgs = {
  tenantId: Scalars['ID']['input'];
};

/** Bill of Materials recipe ingredient linking menu dishes to FIFO kitchen store batches. */
export type RecipeBomIngredient = {
  __typename?: 'RecipeBomIngredient';
  /** Estimated replacement cost per unit in LKR for live food costing. */
  costPerUnitLkr: Scalars['Float']['output'];
  /** Quantity consumed per portion. */
  quantityRequired: Scalars['Float']['output'];
  /** Stock inventory item identifier. */
  stockItemId: Scalars['ID']['output'];
  /** Stock item display name (e.g. 'Jumbo Tiger Prawns Grade A', 'Coconut Milk 1L'). */
  stockItemName: Scalars['String']['output'];
  /** Unit of measure (KG, L, PORTION, G). */
  unitOfMeasure: Scalars['String']['output'];
};

/** Input for recipe Bill of Materials ingredient. */
export type RecipeBomIngredientInput = {
  costPerUnitLkr: Scalars['Float']['input'];
  quantityRequired: Scalars['Float']['input'];
  stockItemId: Scalars['ID']['input'];
  stockItemName: Scalars['String']['input'];
  unitOfMeasure: Scalars['String']['input'];
};

/** Input for recording Goods Received Notes into FIFO inventory. */
export type RecordGrnInput = {
  department: Department;
  grnDate: Scalars['AWSDate']['input'];
  items: Array<GrnItemInput>;
  poNumber?: InputMaybe<Scalars['String']['input']>;
  remarks?: InputMaybe<Scalars['String']['input']>;
  supplierName: Scalars['String']['input'];
};

/** Primary guest room reservation record tracking lifecycle, rates, guests, and folios. */
export type Reservation = {
  __typename?: 'Reservation';
  /** Actual front desk check-in timestamp. */
  actualCheckInTime: Maybe<Scalars['AWSDateTime']['output']>;
  /** Actual front desk check-out timestamp. */
  actualCheckOutTime: Maybe<Scalars['AWSDateTime']['output']>;
  /** Number of adult guests staying. */
  adultsCount: Scalars['Int']['output'];
  /** Expanded allocated room details. */
  assignedRoom: Maybe<Room>;
  /** Physically allocated room identifier (set at check-in or pre-allocated). */
  assignedRoomId: Maybe<Scalars['ID']['output']>;
  /** Scheduled arrival date. */
  checkInDate: Scalars['AWSDate']['output'];
  /** Scheduled departure date. */
  checkOutDate: Scalars['AWSDate']['output'];
  /** Number of child guests staying. */
  childrenCount: Scalars['Int']['output'];
  /** Human-friendly reservation confirmation code (e.g. 'RES-58192'). */
  confirmationCode: Scalars['String']['output'];
  /** Timestamp of creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Associated chauffeur accommodation details. */
  driverAccommodation: Maybe<DriverAccommodation>;
  /** Inbound flight number and estimated arrival time. */
  flightDetails: Maybe<Scalars['String']['output']>;
  /** Expanded group booking. */
  groupBooking: Maybe<GroupBooking>;
  /** Parent group booking identifier if part of tour series. */
  groupBookingId: Maybe<Scalars['ID']['output']>;
  /** Guest notification email. */
  guestEmail: Scalars['AWSEmail']['output'];
  /** Primary guest display name. */
  guestName: Scalars['String']['output'];
  /** Guest nationality country string. */
  guestNationality: Maybe<Scalars['String']['output']>;
  /** National Identity Card (NIC) number for Sri Lankan residents. */
  guestNic: Maybe<Scalars['String']['output']>;
  /** Passport number for foreign non-resident tourists. */
  guestPassportNumber: Maybe<Scalars['String']['output']>;
  /** Guest contact phone. */
  guestPhone: Scalars['AWSPhone']['output'];
  /** Unique reservation identifier. */
  id: Scalars['ID']['output'];
  /** Locked CBSL USD-to-LKR buying exchange rate at booking creation. */
  lockedExchangeRate: Maybe<Scalars['Float']['output']>;
  /** Contracted meal plan arrangement. */
  mealPlan: MealPlan;
  /** Contactless room QR session HMAC token. */
  qrSessionToken: Maybe<Scalars['String']['output']>;
  /** Quoted total base rate amount. */
  quotedRateAmount: Scalars['Float']['output'];
  /** Quoted currency ('LKR' for residents, 'USD' for foreign tourists). */
  quotedRateCurrency: Scalars['String']['output'];
  /** Sri Lankan Resident (LKR) or Foreign Non-Resident (USD) rate category. */
  rateTier: ResidencyRateTier;
  /** Expanded room type details. */
  roomType: Maybe<RoomType>;
  /** Booked room type identifier. */
  roomTypeId: Scalars['ID']['output'];
  /** Special dietary, honeymoon, or accessibility requests. */
  specialRequests: Maybe<Scalars['String']['output']>;
  /** Current reservation lifecycle status. */
  status: ReservationStatus;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Expanded tour operator contract. */
  tourOperatorContract: Maybe<TourOperatorContract>;
  /** Associated tour operator / DMC contract if agency booking. */
  tourOperatorContractId: Maybe<Scalars['ID']['output']>;
  /** Physical tour voucher number issued by the DMC. */
  tourVoucherNumber: Maybe<Scalars['String']['output']>;
  /** Sri Lanka Tourist Police B-Card registration serial number. */
  touristPoliceBCardNumber: Maybe<Scalars['String']['output']>;
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Reservation lifecycle states for front desk tape chart and booking engine. */
export enum ReservationStatus {
  /** Reservation cancelled by guest, OTA, or property. */
  Cancelled = 'CANCELLED',
  /** Guest checked-in, room key issued, active folio open. */
  CheckedIn = 'CHECKED_IN',
  /** Guest settled all folios and checked out. */
  CheckedOut = 'CHECKED_OUT',
  /** Confirmed reservation with secured advance deposit or DMC voucher. */
  Confirmed = 'CONFIRMED',
  /** Provisional reservation inquiry awaiting advance deposit or payment link. */
  Inquiry = 'INQUIRY',
  /** Guest failed to arrive by night audit cutoff. */
  NoShow = 'NO_SHOW'
}

/** Dual-tier pricing and statutory tax residency tiers for Sri Lankan tourism. */
export enum ResidencyRateTier {
  /** Diplomatic mission staff and tax-exempt international agencies. */
  DiplomaticExempt = 'DIPLOMATIC_EXEMPT',
  /** International foreign passport holders and tourists (contracted in USD, locked to LKR). */
  ForeignNonResident = 'FOREIGN_NON_RESIDENT',
  /** Sri Lankan citizens holding NIC and permanent resident visa holders (billed in LKR). */
  SriLankanResident = 'SRI_LANKAN_RESIDENT'
}

/** Physical room or standalone villa within the property with live housekeeping and occupancy status. */
export type Room = {
  __typename?: 'Room';
  /** Building wing, block name, or garden sector. */
  building: Maybe<Scalars['String']['output']>;
  /** Timestamp of creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Identifier of active checked-in reservation folio. */
  currentReservationId: Maybe<Scalars['ID']['output']>;
  /** Floor number or level within the building. */
  floor: Maybe<Scalars['String']['output']>;
  /** Current housekeeping and cleanliness inspection status. */
  housekeepingStatus: HousekeepingStatus;
  /** Unique physical room identifier. */
  id: Scalars['ID']['output'];
  /** Whether a guest is currently checked in to this room. */
  isOccupied: Scalars['Boolean']['output'];
  /** Internal front desk or housekeeping maintenance notes. */
  notes: Maybe<Scalars['String']['output']>;
  /** Cryptographic secret salt for contactless guest room QR tokens. */
  qrTokenSecret: Maybe<Scalars['String']['output']>;
  /** Human-readable room or villa number (e.g. '101', 'Villa 4', 'Tea Cottage 2'). */
  roomNumber: Scalars['String']['output'];
  /** Expanded room type details. */
  roomType: Maybe<RoomType>;
  /** Associated room category identifier. */
  roomTypeId: Scalars['ID']['output'];
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Room category classification modeling capacity, amenities, base pricing, and seasonal bands. */
export type RoomType = {
  __typename?: 'RoomType';
  /** List of room features and amenities (e.g. 'Private Plunge Pool', 'Ceylon Tea Bar'). */
  amenities: Array<Scalars['String']['output']>;
  /** Default standard night rate in USD for international guests. */
  baseRateForeignUsd: Scalars['Float']['output'];
  /** Default standard night rate in LKR for Sri Lankan residents. */
  baseRateResidentLkr: Scalars['Float']['output'];
  /** Property-unique short code (e.g. 'DLX-OCN', 'VIL-POOL', 'STE-PRES'). */
  code: Scalars['String']['output'];
  /** Timestamp of creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Detailed descriptive summary of the room category. */
  description: Scalars['String']['output'];
  /** Unique room type identifier. */
  id: Scalars['ID']['output'];
  /** Whether this room category is currently bookable. */
  isActive: Scalars['Boolean']['output'];
  /** Maximum adult guest capacity. */
  maxOccupancyAdults: Scalars['Int']['output'];
  /** Maximum child guest capacity. */
  maxOccupancyChildren: Scalars['Int']['output'];
  /** Marketing display name (e.g. 'Deluxe Ocean View Villa', 'Heritage Tea Suite'). */
  name: Scalars['String']['output'];
  /** Gallery photos for guest booking engine and room QR showcase. */
  photos: Array<Scalars['AWSURL']['output']>;
  /** Configured seasonal pricing bands overriding base rate during special periods. */
  rateBands: Array<SeasonalRateBand>;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Total count of physical rooms belonging to this category. */
  totalRoomCount: Scalars['Int']['output'];
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Input for executing the daily automated or manual night audit rollover. */
export type RunNightAuditInput = {
  auditDate: Scalars['AWSDate']['input'];
  notes?: InputMaybe<Scalars['String']['input']>;
};

/** Seasonal pricing window with dual-tier rates (Sri Lankan Resident LKR vs Foreign Non-Resident USD). */
export type SeasonalRateBand = {
  __typename?: 'SeasonalRateBand';
  /** End date of the seasonal rate window (inclusive). */
  endDate: Scalars['AWSDate']['output'];
  /** Nightly room rate in US Dollars for international tourists. */
  foreignRateUsd: Scalars['Float']['output'];
  /** Unique seasonal band identifier. */
  id: Scalars['ID']['output'];
  /** Minimum stay duration in nights during this seasonal period. */
  minimumStayNights: Scalars['Int']['output'];
  /** Season label (e.g. 'Peak Winter Season', 'Kandy Esala Perahera', 'Shoulder Season'). */
  name: Scalars['String']['output'];
  /** Nightly room rate in Sri Lankan Rupees for domestic residents (NIC verified). */
  residentRateLkr: Scalars['Float']['output'];
  /** Start date of the seasonal rate window (inclusive). */
  startDate: Scalars['AWSDate']['output'];
};

/** Input for seasonal pricing window configuration. */
export type SeasonalRateBandInput = {
  endDate: Scalars['AWSDate']['input'];
  foreignRateUsd: Scalars['Float']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
  minimumStayNights: Scalars['Int']['input'];
  name: Scalars['String']['input'];
  residentRateLkr: Scalars['Float']['input'];
  startDate: Scalars['AWSDate']['input'];
};

/**
 * Live real-time Food & Beverage service order (Kitchen Order Ticket / Bar Order Ticket).
 * Supports dual guest QR (@aws_lambda) and staff (@aws_cognito_user_pools) authorization.
 */
export type ServiceOrder = {
  __typename?: 'ServiceOrder';
  /** Reason for order cancellation. */
  cancelReason: Maybe<Scalars['String']['output']>;
  /** Timestamp when order was cancelled. */
  cancelledAt: Maybe<Scalars['AWSDateTime']['output']>;
  /** Timestamp when order was delivered to guest. */
  deliveredAt: Maybe<Scalars['AWSDateTime']['output']>;
  /** Fulfillment department (KITCHEN, BAR). */
  department: Department;
  /** Dining channel (IN_ROOM_DINING, TABLE_SERVICE, POOL_SIDE, BEACH_CABANA). */
  diningType: DiningType;
  /** Guest folio identifier if charged to room folio. */
  folioId: Maybe<Scalars['ID']['output']>;
  /** Customer special delivery instructions. */
  guestNotes: Maybe<Scalars['String']['output']>;
  /** Unique service order identifier. */
  id: Scalars['ID']['output'];
  /** Ordered dish items and modifiers. */
  items: Array<OrderLineItem>;
  /** Timestamp when kitchen acknowledged order. */
  kitchenAcknowledgedAt: Maybe<Scalars['AWSDateTime']['output']>;
  /** Sequential daily kitchen order ticket number (e.g. 'KOT-2026-00142'). */
  orderNumber: Scalars['String']['output'];
  /** Timestamp when guest or waiter submitted order. */
  orderPlacedAt: Scalars['AWSDateTime']['output'];
  /** Timestamp when order was bumped ready for pickup by kitchen runner. */
  readyForPickupAt: Maybe<Scalars['AWSDateTime']['output']>;
  /** Associated guest room reservation identifier. */
  reservationId: Maybe<Scalars['ID']['output']>;
  /** Guest room or villa number if in-room dining. */
  roomNumber: Maybe<Scalars['String']['output']>;
  /** Current order lifecycle status in kitchen / runner flow. */
  status: OrderStatus;
  /** Subtotal amount in LKR prior to service charge and taxes. */
  subtotalLkr: Scalars['Float']['output'];
  /** Restaurant table number if dine-in table service. */
  tableNumber: Maybe<Scalars['String']['output']>;
  /** Statutory 4-stage compounding tax itemization. */
  taxBreakdown: TaxBreakdown;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Gross order total in Sri Lankan Rupees. */
  totalGrossLkr: Scalars['Float']['output'];
  /** Timestamp of latest status update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Input for settling an open folio and producing an official IRD tax invoice. */
export type SettleFolioInput = {
  amountLkr: Scalars['Float']['input'];
  folioId: Scalars['ID']['input'];
  guestAddress?: InputMaybe<Scalars['String']['input']>;
  guestNicOrPassport?: InputMaybe<Scalars['String']['input']>;
  paymentMethod: PaymentMethod;
  paymentReference?: InputMaybe<Scalars['String']['input']>;
};

/** Sri Lanka Tourism Development Authority (SLTDA) Monthly Statistical Return (Tourism Act No. 38 of 2005). */
export type SltdaMonthlyReturn = {
  __typename?: 'SltdaMonthlyReturn';
  /** Average Daily Rate (ADR) achieved in LKR. */
  averageDailyRateLkr: Scalars['Float']['output'];
  /** Average monthly room occupancy percentage. */
  averageOccupancyRate: Scalars['Float']['output'];
  /** Timestamp of return record creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Unique statutory return identifier. */
  id: Scalars['ID']['output'];
  /** Submission status to SLTDA Tourism Information Management System (TIMS). */
  isSubmitted: Scalars['Boolean']['output'];
  /** Calendar month of the return (1-12). */
  month: Scalars['Int']['output'];
  /** Itemized foreign and domestic guest breakdown by nationality. */
  nationalityBreakdown: Array<NationalityGuestCount>;
  /** Revenue Per Available Room (RevPAR) achieved in LKR. */
  revParLkr: Scalars['Float']['output'];
  /** Official SLTDA hotel/guesthouse registration number. */
  sltdaRegNo: Scalars['String']['output'];
  /** Government submission acknowledgement reference code. */
  submissionReference: Maybe<Scalars['String']['output']>;
  /** Timestamp when submitted to SLTDA portal. */
  submittedAt: Maybe<Scalars['AWSDateTime']['output']>;
  /** User identifier of hotel administrator submitting the return. */
  submittedByUserId: Maybe<Scalars['ID']['output']>;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Total guest nights recorded by Sri Lankan resident domestic travelers. */
  totalDomesticGuestNights: Scalars['Int']['output'];
  /** Total guest nights recorded by foreign tourists. */
  totalForeignGuestNights: Scalars['Int']['output'];
  /** Gross accommodation revenue subject to SLTDA levy in LKR. */
  totalGrossAccommodationTurnoverLkr: Scalars['Float']['output'];
  /** Total guest check-in arrivals recorded. */
  totalGuestArrivals: Scalars['Int']['output'];
  /** Available room nights across the entire month. */
  totalRoomNightsAvailable: Scalars['Int']['output'];
  /** Total room nights sold/occupied during the month. */
  totalRoomNightsSold: Scalars['Int']['output'];
  /** Total physical guest rooms available for sale. */
  totalRoomsInInventory: Scalars['Int']['output'];
  /** Timestamp of latest return update. */
  updatedAt: Scalars['AWSDateTime']['output'];
  /** Calendar year of the return. */
  year: Scalars['Int']['output'];
};

/**
 * Split folio charge routing rule directing specific departments or amounts to separate folios.
 * Enables standard Sri Lankan practice: Room and contracted meals to DMC voucher folio, Extras / Minibar / Spa to Guest folio.
 */
export type SplitFolioRouting = {
  __typename?: 'SplitFolioRouting';
  /** DMC credit agreement identifier if billing to tour operator City Ledger. */
  billToTourOperatorContractId: Maybe<Scalars['ID']['output']>;
  /** Department charges to automatically route (null routes all unassigned). */
  department: Maybe<Department>;
  /** Fixed cap amount in LKR to route. */
  fixedAmountLkr: Maybe<Scalars['Float']['output']>;
  /** Unique routing rule identifier. */
  id: Scalars['ID']['output'];
  /** Percentage of charge to route to this folio (1.0 to 100.0). */
  percentage: Maybe<Scalars['Float']['output']>;
  /** Target sub-folio designation (e.g. 'GUEST_EXTRAS', 'DMC_MASTER'). */
  targetFolioType: Scalars['String']['output'];
};

/** Individual employee share in the 10% Service Charge monthly distribution pool. */
export type StaffScMemberShare = {
  __typename?: 'StaffScMemberShare';
  /** Staff member primary operating department. */
  department: Department;
  /** Statutory EPF employee 8% deduction from SC share in LKR. */
  epfDeduction8PctLkr: Scalars['Float']['output'];
  /** Gross service charge share allocated in LKR. */
  grossScShareLkr: Scalars['Float']['output'];
  /** Net take-home service charge disbursed in LKR. */
  netScDisbursedLkr: Scalars['Float']['output'];
  /** Seniority weighting points or rostered working days. */
  pointsOrHours: Scalars['Float']['output'];
  /** Full name of staff member. */
  staffName: Scalars['String']['output'];
  /** Staff member unique user identifier. */
  userId: Scalars['ID']['output'];
};

/**
 * Sri Lankan 10% Hotel Service Charge Monthly Pool Distribution Statement.
 * Enforces breakage reserve cap, EPF deduction, and equal or points-weighted distribution.
 */
export type StaffScPoolStatement = {
  __typename?: 'StaffScPoolStatement';
  /** User identifier of General Manager or Financial Controller authorising disbursement. */
  authorizedByUserId: Maybe<Scalars['ID']['output']>;
  /** Breakage fund reserve deduction amount retained in LKR. */
  breakageReserveAmountLkr: Scalars['Float']['output'];
  /** Agreed breakage deduction percentage (e.g. 5.0% or 10.0%). */
  breakageReserveDeductionPct: Scalars['Float']['output'];
  /** Timestamp of pool statement creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Timestamp when disbursement was completed. */
  disbursedAt: Maybe<Scalars['AWSDateTime']['output']>;
  /** Net distributable pool remaining for staff in LKR. */
  distributablePoolLkr: Scalars['Float']['output'];
  /** Count of eligible employees participating in the pool. */
  eligibleStaffCount: Scalars['Int']['output'];
  /** Unique statement identifier. */
  id: Scalars['ID']['output'];
  /** Disbursement authorization status. */
  isDisbursed: Scalars['Boolean']['output'];
  /** Calendar month of the distribution pool (1-12). */
  month: Scalars['Int']['output'];
  /** Individual staff member distribution breakdowns. */
  staffShares: Array<StaffScMemberShare>;
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Total net amount disbursed to staff in LKR. */
  totalScDisbursedLkr: Scalars['Float']['output'];
  /** Total 10% service charge collected across all property folios during the month in LKR. */
  totalServiceChargeCollectedLkr: Scalars['Float']['output'];
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
  /** Calendar year of the distribution pool. */
  year: Scalars['Int']['output'];
};

/** Store inventory SKU item with multi-department allocation, par levels, and FIFO costing. */
export type StockItem = {
  __typename?: 'StockItem';
  /** Itemized FIFO layers currently on hand. */
  batches: Array<FifoBatch>;
  /** Storage category ('FOOD_DRY_GOODS', 'BEVERAGE_SPIRITS', 'FRESH_PRODUCE', 'HOUSEKEEPING_LINEN', 'MAINTENANCE_SPARES'). */
  category: Scalars['String']['output'];
  /** Timestamp of stock item creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Total physically available quantity across active batches. */
  currentStock: Scalars['Float']['output'];
  /** Owning operating department. */
  department: Department;
  /** Effective FIFO unit cost in LKR (or latest batch cost if depleted). */
  fifoCostPerUnitLkr: Scalars['Float']['output'];
  /** Unique stock item identifier. */
  id: Scalars['ID']['output'];
  /** Active operational item flag. */
  isActive: Scalars['Boolean']['output'];
  /** Item trade / display name. */
  name: Scalars['String']['output'];
  /** Safety stock threshold triggering automated purchase requisition. */
  parLevel: Scalars['Float']['output'];
  /** Standard replenishment batch order quantity. */
  reorderQuantity: Scalars['Float']['output'];
  /** Stock Keeping Unit code (e.g. 'DRY-BASMATI-001', 'LIQ-ARRACK-0750'). */
  sku: Scalars['String']['output'];
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Total valuation of on-hand inventory (sum of remaining FIFO batch values). */
  totalValueLkr: Scalars['Float']['output'];
  /** Standard inventory unit of measure ('kg', 'liters', 'bottles', 'units', 'packets'). */
  unitOfMeasure: Scalars['String']['output'];
  /** Timestamp of latest stock item update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type Subscription = {
  __typename?: 'Subscription';
  /** Real-time WebSocket event fired when a guest folio has new charges posted or updated. */
  onFolioUpdated: Maybe<Folio>;
  /** Real-time WebSocket event fired when an order lifecycle status changes on KDS. */
  onOrderStatusUpdated: Maybe<ServiceOrder>;
  /** Real-time WebSocket event for kitchen expediter and guest QR order status tracking. */
  onOrderUpdated: Maybe<ServiceOrder>;
  /** Real-time health check subscription for WebSocket connectivity validation. */
  onPing: Maybe<Scalars['String']['output']>;
  /** Real-time WebSocket event fired when a new reservation is booked, checked in, or checked out. */
  onReservationUpdated: Maybe<Reservation>;
  /** Real-time WebSocket event fired when room housekeeping status changes or room is modified. */
  onRoomStatusChanged: Maybe<Room>;
  /** Real-time WebSocket event fired when a new guest QR room service order is placed. */
  onServiceOrderCreated: Maybe<ServiceOrder>;
};


export type SubscriptionOnFolioUpdatedArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnOrderStatusUpdatedArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnOrderUpdatedArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnReservationUpdatedArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnRoomStatusChangedArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnServiceOrderCreatedArgs = {
  tenantId: Scalars['ID']['input'];
};

/** Granular 4-stage compounding tax itemization for folios, bills, and IRD reporting. */
export type TaxBreakdown = {
  __typename?: 'TaxBreakdown';
  /** Net supply base amount prior to any service charge or statutory tax. */
  baseSupplyLkr: Scalars['Float']['output'];
  /** Effective compounding tax rate percentage over net base supply. */
  effectiveTaxRate: Scalars['Float']['output'];
  /** 10% Service charge component. */
  serviceChargeLkr: Scalars['Float']['output'];
  /** 2.5641% Social Security Contribution Levy component. */
  ssclLkr: Scalars['Float']['output'];
  /** 1% Tourism Development Levy component. */
  tdlLkr: Scalars['Float']['output'];
  /** Final gross payable amount inclusive of base supply, service charge, and taxes. */
  totalGrossLkr: Scalars['Float']['output'];
  /** Combined sum of service charge and all statutory government levies. */
  totalTaxAndServiceLkr: Scalars['Float']['output'];
  /** 18% Value Added Tax component. */
  vatLkr: Scalars['Float']['output'];
};

/** Sri Lankan statutory tax registration status and compounding preset. */
export enum TaxCategory {
  /** Boutique villa under LKR 60M annual VAT threshold (10% SC + 1% TDL + 2.5641% SSCL). */
  BoutiqueNonVat = 'BOUTIQUE_NON_VAT',
  /** Full-service registered hotel charging 10% SC + 1% TDL + 2.5641% SSCL + 18% VAT. */
  FullServiceHotelVat = 'FULL_SERVICE_HOTEL_VAT',
  /** Small guest house under LKR 12M annual turnover (0.5% TDL only). */
  SmallGuesthouseTdl = 'SMALL_GUESTHOUSE_TDL',
  /** Special statutory economic zone or export development tax-exempt status. */
  TaxExempt = 'TAX_EXEMPT'
}

/** Sri Lankan 4-stage compounding statutory tax parameters. */
export type TaxConfig = {
  __typename?: 'TaxConfig';
  /** Flag indicating whether 10% Service Charge is applied. */
  applySc: Scalars['Boolean']['output'];
  /** Flag indicating whether Social Security Contribution Levy is applied. */
  applySscl: Scalars['Boolean']['output'];
  /** Flag indicating whether Tourism Development Levy is applied. */
  applyTdl: Scalars['Boolean']['output'];
  /** Flag indicating whether Value Added Tax is applied. */
  applyVat: Scalars['Boolean']['output'];
  /** Mandatory hotel service charge percentage (typically 10.0%). */
  scPercent: Scalars['Float']['output'];
  /** Social Security Contribution Levy standard rate (typically 2.5641%). */
  ssclPercent: Scalars['Float']['output'];
  /** Statutory tax preset category. */
  taxCategory: TaxCategory;
  /** Tourism Development Levy percentage under Tourism Act (typically 1.0% or 0.5%). */
  tdlPercent: Scalars['Float']['output'];
  /** Value Added Tax standard rate under Inland Revenue Act (typically 18.0%). */
  vatPercent: Scalars['Float']['output'];
};

/** Input payload for configuring Sri Lankan statutory tax parameters. */
export type TaxConfigInput = {
  applySc: Scalars['Boolean']['input'];
  applySscl: Scalars['Boolean']['input'];
  applyTdl: Scalars['Boolean']['input'];
  applyVat: Scalars['Boolean']['input'];
  scPercent?: InputMaybe<Scalars['Float']['input']>;
  ssclPercent?: InputMaybe<Scalars['Float']['input']>;
  taxCategory: TaxCategory;
  tdlPercent?: InputMaybe<Scalars['Float']['input']>;
  vatPercent?: InputMaybe<Scalars['Float']['input']>;
};

/** Inland Revenue Department (IRD) & SLTDA Tourism Development Levy (TDL) Quarterly Summary. */
export type TdlQuarterlySummary = {
  __typename?: 'TdlQuarterlySummary';
  /** Timestamp of statement generation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Unique quarterly summary identifier. */
  id: Scalars['ID']['output'];
  /** Whether quarterly tax payment has been settled. */
  isPaid: Scalars['Boolean']['output'];
  /** Month 1 TDL liability payable in LKR. */
  month1TdlPayableLkr: Scalars['Float']['output'];
  /** Month 1 gross turnover in LKR. */
  month1TurnoverLkr: Scalars['Float']['output'];
  /** Month 2 TDL liability payable in LKR. */
  month2TdlPayableLkr: Scalars['Float']['output'];
  /** Month 2 gross turnover in LKR. */
  month2TurnoverLkr: Scalars['Float']['output'];
  /** Month 3 TDL liability payable in LKR. */
  month3TdlPayableLkr: Scalars['Float']['output'];
  /** Month 3 gross turnover in LKR. */
  month3TurnoverLkr: Scalars['Float']['output'];
  /** Date of bank tax payment. */
  paidDate: Maybe<Scalars['AWSDate']['output']>;
  /** Bank or LankaPay settlement voucher reference number. */
  paymentVoucherRef: Maybe<Scalars['String']['output']>;
  /** Quarter of assessment (1 = Jan-Mar, 2 = Apr-Jun, 3 = Jul-Sep, 4 = Oct-Dec). */
  quarter: Scalars['Int']['output'];
  /** Official SLTDA registration reference number. */
  sltdaRegNo: Scalars['String']['output'];
  /** Assessment tax year. */
  taxYear: Scalars['Int']['output'];
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Inland Revenue Department Tax Identification Number (TIN). */
  tinNo: Scalars['String']['output'];
  /** Grand total TDL liability for the quarter in LKR. */
  totalQuarterlyTdlPayableLkr: Scalars['Float']['output'];
  /** Total quarterly turnover subject to TDL in LKR. */
  totalQuarterlyTurnoverLkr: Scalars['Float']['output'];
  /** Timestamp of latest update. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/**
 * Destination Management Company (DMC) or Tour Operator wholesale credit agreement.
 * Supports major Sri Lankan inbound operators (Aitken Spence, Walkers Tours, Jetwing, etc.).
 */
export type TourOperatorContract = {
  __typename?: 'TourOperatorContract';
  /** Corporate legal name of the tour company. */
  companyName: Scalars['String']['output'];
  /** Official billing and voucher submission email. */
  contactEmail: Scalars['AWSEmail']['output'];
  /** Primary account manager contact person. */
  contactPerson: Scalars['String']['output'];
  /** Primary telephone number for operations dispatch. */
  contactPhone: Scalars['AWSPhone']['output'];
  /** Property-assigned contract code (e.g. 'DMC-AITKEN-2026', 'DMC-WALKERS'). */
  contractCode: Scalars['String']['output'];
  /** Timestamp of contract creation. */
  createdAt: Scalars['AWSDateTime']['output'];
  /** Agreed payment terms window in days (typically 30, 45, or 60 days). */
  creditDays: Scalars['Int']['output'];
  /** Approved credit limit in Sri Lankan Rupees for City Ledger charging. */
  creditLimitLkr: Scalars['Float']['output'];
  /** Contracted wholesale discount percentage off standard rates. */
  discountPercent: Scalars['Float']['output'];
  /** Unique DMC contract identifier. */
  id: Scalars['ID']['output'];
  /** Whether the credit contract is in active good standing. */
  isActive: Scalars['Boolean']['output'];
  /** Multi-tenant property identifier. */
  tenantId: Scalars['ID']['output'];
  /** Timestamp of latest modification. */
  updatedAt: Scalars['AWSDateTime']['output'];
};

/** Trilingual text representation supporting English, Sinhala, and Tamil for Sri Lankan hospitality menus. */
export type TrilingualText = {
  __typename?: 'TrilingualText';
  /** English text. */
  en: Scalars['String']['output'];
  /** Sinhala translation (e.g. 'දෙවල් ඉස්සෝ'). */
  si: Maybe<Scalars['String']['output']>;
  /** Tamil translation (e.g. 'டெவில்ட் இறால்'). */
  ta: Maybe<Scalars['String']['output']>;
};

/** Input for trilingual text fields. */
export type TrilingualTextInput = {
  en: Scalars['String']['input'];
  si?: InputMaybe<Scalars['String']['input']>;
  ta?: InputMaybe<Scalars['String']['input']>;
};

/** Input for kitchen expeditor or runner updating order ticket status. */
export type UpdateOrderStatusInput = {
  cancelReason?: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['ID']['input'];
  status: OrderStatus;
};

/** Input for creating or updating a Banquet Event Order (BEO). */
export type UpsertBanquetEventInput = {
  advanceDepositPaidLkr?: InputMaybe<Scalars['Float']['input']>;
  ashtakaChantingTime?: InputMaybe<Scalars['AWSTime']['input']>;
  bitePlates?: InputMaybe<Array<BitePlateItemInput>>;
  brideAndGroomNames?: InputMaybe<Scalars['String']['input']>;
  clientEmail: Scalars['AWSEmail']['input'];
  clientName: Scalars['String']['input'];
  clientPhone: Scalars['AWSPhone']['input'];
  corkageBottleCount?: InputMaybe<Scalars['Int']['input']>;
  corkageFeeTotalLkr: Scalars['Float']['input'];
  endTime: Scalars['AWSTime']['input'];
  eventDate: Scalars['AWSDate']['input'];
  eventNumber?: InputMaybe<Scalars['String']['input']>;
  eventType: Scalars['String']['input'];
  guaranteedGuestCount: Scalars['Int']['input'];
  hallId: Scalars['ID']['input'];
  hallRentalChargeLkr: Scalars['Float']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
  perPlateRateLkr: Scalars['Float']['input'];
  poruwaCeremonyTime?: InputMaybe<Scalars['AWSTime']['input']>;
  selectedMenuPackageName: Scalars['String']['input'];
  setupNotes?: InputMaybe<Scalars['String']['input']>;
  slot: Scalars['String']['input'];
  startTime: Scalars['AWSTime']['input'];
  status?: InputMaybe<Scalars['String']['input']>;
};

/** Input for managing banquet hall venues. */
export type UpsertBanquetHallInput = {
  features: Array<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isActive: Scalars['Boolean']['input'];
  maxSeatingCapacity: Scalars['Int']['input'];
  name: Scalars['String']['input'];
  rentalRateLkr: Scalars['Float']['input'];
};

/** Input for managing driver dorm bed inventory. */
export type UpsertDriverDormBedInput = {
  associatedGuestRoomNumber?: InputMaybe<Scalars['String']['input']>;
  bedNumber: Scalars['String']['input'];
  currentDriverName?: InputMaybe<Scalars['String']['input']>;
  currentDriverNic?: InputMaybe<Scalars['String']['input']>;
  currentDriverPhone?: InputMaybe<Scalars['AWSPhone']['input']>;
  currentTourOperatorId?: InputMaybe<Scalars['ID']['input']>;
  dormSection: Scalars['String']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
  isComplimentary: Scalars['Boolean']['input'];
  isOccupied?: InputMaybe<Scalars['Boolean']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  ratePerNightLkr: Scalars['Float']['input'];
};

/** Input payload for creating or updating a multi-tenant hotel profile. */
export type UpsertHotelTenantInput = {
  address: Scalars['String']['input'];
  bannerUrl?: InputMaybe<Scalars['AWSURL']['input']>;
  businessType: BusinessType;
  cbslUsdRateLkr: Scalars['Float']['input'];
  city: Scalars['String']['input'];
  email: Scalars['AWSEmail']['input'];
  /** Tenant identifier (omitted for new tenant auto-provisioning). */
  id?: InputMaybe<Scalars['ID']['input']>;
  lankaQrMerchantId?: InputMaybe<Scalars['String']['input']>;
  logoUrl?: InputMaybe<Scalars['AWSURL']['input']>;
  name: Scalars['String']['input'];
  phone: Scalars['AWSPhone']['input'];
  postalCode?: InputMaybe<Scalars['String']['input']>;
  sltdaRegNo?: InputMaybe<Scalars['String']['input']>;
  taxConfig: TaxConfigInput;
  tinNo?: InputMaybe<Scalars['String']['input']>;
  vatRegNo?: InputMaybe<Scalars['String']['input']>;
};

/** Input for creating or updating a menu category. */
export type UpsertMenuCategoryInput = {
  department: Department;
  description?: InputMaybe<TrilingualTextInput>;
  diningTypes: Array<DiningType>;
  displayOrder: Scalars['Int']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
  isActive: Scalars['Boolean']['input'];
  name: TrilingualTextInput;
};

/** Input for creating or updating a menu item. */
export type UpsertMenuItemInput = {
  categoryId: Scalars['ID']['input'];
  code: Scalars['String']['input'];
  department: Department;
  description: TrilingualTextInput;
  displayOrder: Scalars['Int']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
  imageUrl?: InputMaybe<Scalars['AWSURL']['input']>;
  isAvailable: Scalars['Boolean']['input'];
  isGlutenFree: Scalars['Boolean']['input'];
  isHalal: Scalars['Boolean']['input'];
  isVegan: Scalars['Boolean']['input'];
  isVegetarian: Scalars['Boolean']['input'];
  kitchenStation?: InputMaybe<Scalars['String']['input']>;
  modifiers?: InputMaybe<Array<ModifierOptionInput>>;
  priceLkr: Scalars['Float']['input'];
  recipeBom?: InputMaybe<Array<RecipeBomIngredientInput>>;
  spicyLevel: Scalars['Int']['input'];
  title: TrilingualTextInput;
};

/** Input for configuring a physical room. */
export type UpsertRoomInput = {
  building?: InputMaybe<Scalars['String']['input']>;
  floor?: InputMaybe<Scalars['String']['input']>;
  housekeepingStatus?: InputMaybe<HousekeepingStatus>;
  id?: InputMaybe<Scalars['ID']['input']>;
  isOccupied?: InputMaybe<Scalars['Boolean']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  roomNumber: Scalars['String']['input'];
  roomTypeId: Scalars['ID']['input'];
};

/** Input for creating or updating a room category. */
export type UpsertRoomTypeInput = {
  amenities?: InputMaybe<Array<Scalars['String']['input']>>;
  baseRateForeignUsd: Scalars['Float']['input'];
  baseRateResidentLkr: Scalars['Float']['input'];
  code: Scalars['String']['input'];
  description: Scalars['String']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
  isActive: Scalars['Boolean']['input'];
  maxOccupancyAdults: Scalars['Int']['input'];
  maxOccupancyChildren: Scalars['Int']['input'];
  name: Scalars['String']['input'];
  photos?: InputMaybe<Array<Scalars['AWSURL']['input']>>;
  rateBands?: InputMaybe<Array<SeasonalRateBandInput>>;
  totalRoomCount: Scalars['Int']['input'];
};

/** Input for provisioning or editing a stock inventory item. */
export type UpsertStockItemInput = {
  category: Scalars['String']['input'];
  department: Department;
  id?: InputMaybe<Scalars['ID']['input']>;
  isActive: Scalars['Boolean']['input'];
  name: Scalars['String']['input'];
  parLevel: Scalars['Float']['input'];
  reorderQuantity: Scalars['Float']['input'];
  sku: Scalars['String']['input'];
  unitOfMeasure: Scalars['String']['input'];
};

/** Input for registering or updating a Tour Operator / DMC credit agreement. */
export type UpsertTourOperatorContractInput = {
  companyName: Scalars['String']['input'];
  contactEmail: Scalars['AWSEmail']['input'];
  contactPerson: Scalars['String']['input'];
  contactPhone: Scalars['AWSPhone']['input'];
  contractCode: Scalars['String']['input'];
  creditDays: Scalars['Int']['input'];
  creditLimitLkr: Scalars['Float']['input'];
  discountPercent: Scalars['Float']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
  isActive: Scalars['Boolean']['input'];
};

/** Multi-tenant Role-Based Access Control (RBAC) user roles. */
export enum UserRole {
  /** Financial controller / accountant managing folios and tax returns. */
  Accountant = 'ACCOUNTANT',
  /** Front desk agent handling check-ins, check-outs, and guest folios. */
  FrontDesk = 'FRONT_DESK',
  /** General Manager with property-wide operational and financial oversight. */
  GeneralManager = 'GENERAL_MANAGER',
  /** Contactless guest accessing room QR ordering without password. */
  GuestQr = 'GUEST_QR',
  /** Housekeeping room attendant updating room cleanliness status. */
  HousekeepingRunner = 'HOUSEKEEPING_RUNNER',
  /** Kitchen expeditor / chef viewing and bumping KDS orders. */
  KitchenKds = 'KITCHEN_KDS',
  /** Night auditor executing daily financial close and room rollover. */
  NightAuditor = 'NIGHT_AUDITOR',
  /** Food & Beverage server handling restaurant and bar POS orders. */
  RestaurantPos = 'RESTAURANT_POS',
  /** Platform super-admin with global tenant management permissions. */
  SuperAdmin = 'SUPER_ADMIN',
  /** Property owner or tenant administrator with full property access. */
  TenantAdmin = 'TENANT_ADMIN'
}
