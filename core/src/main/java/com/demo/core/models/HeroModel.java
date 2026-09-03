/*
 * Copyright 2026 Demo AI Site
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

/**
 * Sling Model backing the {@code demo-ai-site/components/hero} component.
 *
 * <p>Exposes an eyebrow, heading, body copy and a primary CTA link. All fields
 * are optional; the HTL renders defensively.</p>
 */
@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class HeroModel {

    @ValueMapValue
    private String eyebrow;

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String body;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    public String getEyebrow() {
        return eyebrow;
    }

    /**
     * @return the heading with newline characters replaced by {@code <br>} for
     *         rendering as HTML. Escapes any pre-existing markup so authoring
     *         plain text remains safe.
     */
    public String getHeading() {
        if (StringUtils.isBlank(heading)) {
            return null;
        }
        return escapeHtml(heading).replace("\n", "<br>");
    }

    public String getBody() {
        return body;
    }

    public String getCtaLabel() {
        return ctaLabel;
    }

    /**
     * @return the CTA link with an {@code .html} extension appended when it
     *         points at a {@code /content} path; external links and links
     *         already carrying an extension are returned unchanged.
     */
    public String getCtaHref() {
        if (StringUtils.isBlank(ctaLink)) {
            return null;
        }
        if (ctaLink.startsWith("/content") && !ctaLink.contains(".")) {
            return ctaLink + ".html";
        }
        return ctaLink;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(eyebrow)
                || StringUtils.isNotBlank(heading)
                || StringUtils.isNotBlank(body)
                || (StringUtils.isNotBlank(ctaLabel) && StringUtils.isNotBlank(ctaLink));
    }

    private static String escapeHtml(String value) {
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }
}
