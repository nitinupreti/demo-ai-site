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

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class FooterCtaModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String body;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    public String getTitle() {
        return title;
    }

    public String getBody() {
        return body;
    }

    public String getCtaLabel() {
        return ctaLabel;
    }

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
        return StringUtils.isNotBlank(title)
                || StringUtils.isNotBlank(body)
                || (StringUtils.isNotBlank(ctaLabel) && StringUtils.isNotBlank(ctaLink));
    }
}
