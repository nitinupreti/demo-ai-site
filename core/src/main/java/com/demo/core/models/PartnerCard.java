/*
 * Copyright 2026 Demo AI Site
 * Licensed under the Apache License, Version 2.0.
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class PartnerCard {

    private static final java.util.regex.Pattern HEX = java.util.regex.Pattern.compile("^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$");

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String body;

    @ValueMapValue
    private String linkPath;

    @ValueMapValue
    private String bgColor;

    public String getTitle() { return title; }
    public String getBody() { return body; }

    public String getHref() {
        if (StringUtils.isBlank(linkPath)) return null;
        if (linkPath.startsWith("/content") && !linkPath.contains(".")) return linkPath + ".html";
        return linkPath;
    }

    /** Sanitized hex background, suitable for HTL `context='styleToken'`. Returns empty when invalid. */
    public String getSafeBg() {
        return (bgColor != null && HEX.matcher(bgColor.trim()).matches()) ? bgColor.trim() : "";
    }

    public String getStyleDeclarations() {
        String bg = getSafeBg();
        return bg.isEmpty() ? "" : "background-color:" + bg;
    }

    /** @deprecated retained so existing templates keep working; prefer {@link #getStyleDeclarations()}. */
    @Deprecated
    public String getStyleTokens() { return getStyleDeclarations(); }

    public boolean isHasContent() { return StringUtils.isNotBlank(title) || StringUtils.isNotBlank(body); }
}
