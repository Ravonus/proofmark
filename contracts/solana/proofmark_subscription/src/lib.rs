use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("PMSubXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

/// Proofmark Subscription Program — SPL token (USDC) based subscriptions.
///
/// Users create subscriptions by delegating token authority to this program.
/// A keeper calls `collect_payment` to pull recurring payments.
/// Users can cancel by revoking delegation.
#[program]
pub mod proofmark_subscription {
    use super::*;

    /// Initialize the subscription program config.
    pub fn initialize(
        ctx: Context<Initialize>,
        treasury: Pubkey,
        allowed_mint: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.treasury = treasury;
        config.allowed_mint = allowed_mint;
        config.subscription_count = 0;
        Ok(())
    }

    /// Create a recurring subscription. First payment is pulled immediately.
    pub fn create_subscription(
        ctx: Context<CreateSubscription>,
        amount: u64,
        interval: i64,
        plan_id: [u8; 32],
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(interval >= 86400, ErrorCode::IntervalTooShort); // min 1 day

        // Pull first payment via CPI transfer
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.subscriber_token.to_account_info(),
                to: ctx.accounts.treasury_token.to_account_info(),
                authority: ctx.accounts.subscriber.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        let clock = Clock::get()?;
        let sub = &mut ctx.accounts.subscription;
        sub.subscriber = ctx.accounts.subscriber.key();
        sub.mint = ctx.accounts.subscriber_token.mint;
        sub.treasury = ctx.accounts.config.treasury;
        sub.amount = amount;
        sub.interval = interval;
        sub.last_paid_at = clock.unix_timestamp;
        sub.expires_at = clock.unix_timestamp + interval;
        sub.active = true;
        sub.lifetime = false;
        sub.plan_id = plan_id;
        sub.bump = ctx.bumps.subscription;

        let config = &mut ctx.accounts.config;
        config.subscription_count += 1;

        emit!(SubscriptionCreated {
            subscriber: sub.subscriber,
            amount,
            interval,
            plan_id,
        });

        Ok(())
    }

    /// Create a lifetime (one-time) subscription.
    pub fn create_lifetime(
        ctx: Context<CreateSubscription>,
        amount: u64,
        plan_id: [u8; 32],
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        // Pull one-time payment
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.subscriber_token.to_account_info(),
                to: ctx.accounts.treasury_token.to_account_info(),
                authority: ctx.accounts.subscriber.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        let clock = Clock::get()?;
        let sub = &mut ctx.accounts.subscription;
        sub.subscriber = ctx.accounts.subscriber.key();
        sub.mint = ctx.accounts.subscriber_token.mint;
        sub.treasury = ctx.accounts.config.treasury;
        sub.amount = amount;
        sub.interval = 0;
        sub.last_paid_at = clock.unix_timestamp;
        sub.expires_at = i64::MAX;
        sub.active = true;
        sub.lifetime = true;
        sub.plan_id = plan_id;
        sub.bump = ctx.bumps.subscription;

        let config = &mut ctx.accounts.config;
        config.subscription_count += 1;

        emit!(LifetimePayment {
            subscriber: sub.subscriber,
            amount,
            plan_id,
        });

        Ok(())
    }

    /// Collect a recurring payment. Callable by anyone (keeper).
    /// Uses delegate authority — subscriber must have approved the program.
    pub fn collect_payment(ctx: Context<CollectPayment>) -> Result<()> {
        let sub = &mut ctx.accounts.subscription;
        require!(sub.active, ErrorCode::NotActive);
        require!(!sub.lifetime, ErrorCode::LifetimeNoRenew);

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= sub.expires_at,
            ErrorCode::PeriodNotElapsed
        );

        // Attempt CPI transfer using delegate authority
        let seeds = &[
            b"sub",
            sub.subscriber.as_ref(),
            &sub.plan_id,
            &[sub.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.subscriber_token.to_account_info(),
                to: ctx.accounts.treasury_token.to_account_info(),
                authority: ctx.accounts.subscription.to_account_info(),
            },
            signer_seeds,
        );

        match token::transfer(transfer_ctx, sub.amount) {
            Ok(_) => {
                sub.last_paid_at = clock.unix_timestamp;
                sub.expires_at = clock.unix_timestamp + sub.interval;
                emit!(PaymentCollected {
                    subscriber: sub.subscriber,
                    amount: sub.amount,
                });
                Ok(())
            }
            Err(_) => {
                sub.active = false;
                emit!(SubscriptionLapsed {
                    subscriber: sub.subscriber,
                });
                Ok(())
            }
        }
    }

    /// Cancel a subscription. Only the subscriber can cancel.
    pub fn cancel(ctx: Context<CancelSubscription>) -> Result<()> {
        let sub = &mut ctx.accounts.subscription;
        require!(
            ctx.accounts.subscriber.key() == sub.subscriber,
            ErrorCode::NotSubscriber
        );
        require!(sub.active, ErrorCode::NotActive);
        require!(!sub.lifetime, ErrorCode::CannotCancelLifetime);

        sub.active = false;
        emit!(SubscriptionCancelled {
            subscriber: sub.subscriber,
        });
        Ok(())
    }
}

// ── Accounts ──

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ProgramConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, ProgramConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, interval: i64, plan_id: [u8; 32])]
pub struct CreateSubscription<'info> {
    #[account(
        init,
        payer = subscriber,
        space = 8 + SubscriptionState::INIT_SPACE,
        seeds = [b"sub", subscriber.key().as_ref(), &plan_id],
        bump
    )]
    pub subscription: Account<'info, SubscriptionState>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, ProgramConfig>,
    #[account(mut)]
    pub subscriber: Signer<'info>,
    #[account(
        mut,
        constraint = subscriber_token.owner == subscriber.key(),
        constraint = subscriber_token.mint == config.allowed_mint,
    )]
    pub subscriber_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = treasury_token.owner == config.treasury,
    )]
    pub treasury_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CollectPayment<'info> {
    #[account(mut)]
    pub subscription: Account<'info, SubscriptionState>,
    #[account(
        mut,
        constraint = subscriber_token.owner == subscription.subscriber,
    )]
    pub subscriber_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = treasury_token.owner == subscription.treasury,
    )]
    pub treasury_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelSubscription<'info> {
    #[account(mut)]
    pub subscription: Account<'info, SubscriptionState>,
    pub subscriber: Signer<'info>,
}

// ── State ──

#[account]
#[derive(InitSpace)]
pub struct ProgramConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub allowed_mint: Pubkey,
    pub subscription_count: u64,
}

#[account]
#[derive(InitSpace)]
pub struct SubscriptionState {
    pub subscriber: Pubkey,      // 32
    pub mint: Pubkey,            // 32
    pub treasury: Pubkey,        // 32
    pub amount: u64,             // 8
    pub interval: i64,           // 8
    pub last_paid_at: i64,       // 8
    pub expires_at: i64,         // 8
    pub active: bool,            // 1
    pub lifetime: bool,          // 1
    pub plan_id: [u8; 32],       // 32
    pub bump: u8,                // 1
}

// ── Events ──

#[event]
pub struct SubscriptionCreated {
    pub subscriber: Pubkey,
    pub amount: u64,
    pub interval: i64,
    pub plan_id: [u8; 32],
}

#[event]
pub struct LifetimePayment {
    pub subscriber: Pubkey,
    pub amount: u64,
    pub plan_id: [u8; 32],
}

#[event]
pub struct PaymentCollected {
    pub subscriber: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SubscriptionLapsed {
    pub subscriber: Pubkey,
}

#[event]
pub struct SubscriptionCancelled {
    pub subscriber: Pubkey,
}

// ── Errors ──

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be positive")]
    InvalidAmount,
    #[msg("Interval must be at least 1 day")]
    IntervalTooShort,
    #[msg("Subscription is not active")]
    NotActive,
    #[msg("Lifetime subscriptions do not renew")]
    LifetimeNoRenew,
    #[msg("Payment period has not elapsed")]
    PeriodNotElapsed,
    #[msg("Only the subscriber can perform this action")]
    NotSubscriber,
    #[msg("Cannot cancel a lifetime subscription")]
    CannotCancelLifetime,
}
